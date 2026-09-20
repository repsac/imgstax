use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::fs;
use std::sync::Mutex;
use tauri::{Emitter, Manager, Window};

// Windows-specific imports for hiding console window
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// The running stacking child process, if any.
///
/// The `Child` itself is held here rather than its PID: the OS cannot recycle a
/// PID while we still own the handle, so `cancel_stacking` can never signal an
/// unrelated process. `start_stacking` takes the child back out of this slot to
/// reap it, which also serves as the "no job running" signal for a later cancel.
static STACKING_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

/// Apply the flags every imgstax subprocess needs, regardless of platform.
fn configure_command(command: &mut Command) {
    // On Windows, prevent a console window from flashing up.
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    #[cfg(not(windows))]
    let _ = command;
}

/// Spawn a fire-and-forget child and reap it on a detached thread.
///
/// `Command::spawn` alone leaves a zombie behind: nothing ever calls `wait`, so
/// the kernel keeps the exit status around for a parent that never asks. These
/// helpers (sound, speech, folder opening) are not awaited by the caller, so the
/// wait has to happen somewhere, and a detached thread is the cheapest place.
fn spawn_and_reap(command: &mut Command, context: &str) -> Result<(), String> {
    configure_command(command);

    let mut child = command
        .spawn()
        .map_err(|e| format!("{}: {}", context, e))?;

    std::thread::spawn(move || {
        let _ = child.wait();
    });

    Ok(())
}

/// Run imgstax to completion with the given extra arguments and return stdout.
///
/// Blocking: call from a blocking thread, never directly from a command body.
fn run_imgstax_blocking(extra_args: Vec<String>) -> Result<String, String> {
    let (cmd, mut args) = get_imgstax_cmd()?;
    args.extend(extra_args);

    let mut command = Command::new(&cmd);
    command.args(&args);
    configure_command(&mut command);

    let output = command
        .output()
        .map_err(|e| format!("Failed to execute imgstax: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("imgstax error: {}", stderr.trim()));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Run imgstax off the UI thread and return its stdout.
async fn run_imgstax(extra_args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_imgstax_blocking(extra_args))
        .await
        .map_err(|e| format!("imgstax task failed: {}", e))?
}

/// Run imgstax off the UI thread and parse its stdout as JSON.
async fn run_imgstax_json<T: serde::de::DeserializeOwned>(
    extra_args: Vec<String>,
) -> Result<T, String> {
    let stdout = run_imgstax(extra_args).await?;
    serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse imgstax output: {}", e))
}

/// Validate recipe ID to prevent path traversal attacks.
/// Recipe IDs must not contain path separators or parent directory references.
fn validate_recipe_id(recipe_id: &str) -> Result<(), String> {
    if recipe_id.is_empty() {
        return Err("Recipe ID cannot be empty".to_string());
    }

    // Check for path separators and parent directory references
    if recipe_id.contains('/') || recipe_id.contains('\\') || recipe_id.contains("..") {
        return Err(format!("Invalid recipe ID '{}': cannot contain path separators or '..'", recipe_id));
    }

    // Check for null bytes
    if recipe_id.contains('\0') {
        return Err("Invalid recipe ID: cannot contain null bytes".to_string());
    }

    Ok(())
}

/// Get the Python interpreter path.
/// Searches for Python in multiple locations with priority order.
/// In production, this won't be used as we'll have the bundled binary.
fn get_python_path() -> Result<String, String> {
    // 1. Check environment variable (explicit override)
    if let Ok(path) = std::env::var("IMGSTAX_PYTHON_PATH") {
        if Path::new(&path).exists() {
            return Ok(path);
        } else {
            eprintln!("Warning: IMGSTAX_PYTHON_PATH is set but path doesn't exist: {}", path);
        }
    }

    // 2. Check common locations first (prioritize user-installed Python over system Python)
    if cfg!(windows) {
        // Windows-specific paths
        let userprofile = std::env::var("USERPROFILE").unwrap_or_else(|_| String::from("C:\\Users"));
        let appdata = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| format!("{}\\AppData\\Local", userprofile));

        let common_paths = vec![
            format!("{}\\AppData\\Local\\Programs\\Python\\Python312\\python.exe", userprofile),
            format!("{}\\AppData\\Local\\Programs\\Python\\Python311\\python.exe", userprofile),
            format!("{}\\AppData\\Local\\Programs\\Python\\Python310\\python.exe", userprofile),
            format!("{}\\Programs\\Python\\Python312\\python.exe", appdata),
            format!("{}\\Programs\\Python\\Python311\\python.exe", appdata),
            "C:\\Python312\\python.exe".to_string(),
            "C:\\Python311\\python.exe".to_string(),
            "C:\\Python310\\python.exe".to_string(),
        ];

        for path in &common_paths {
            if Path::new(path).exists() {
                return Ok(path.clone());
            }
        }

        // Try to find python in PATH using 'where' on Windows
        let mut where_cmd = Command::new("where");
        where_cmd.arg("python");
        configure_command(&mut where_cmd);
        if let Ok(output) = where_cmd.output() {
            if output.status.success() {
                if let Ok(stdout) = String::from_utf8(output.stdout) {
                    // where can return multiple paths, filter out Microsoft Store stub
                    for line in stdout.lines() {
                        let path = line.trim();
                        if path.is_empty() {
                            continue;
                        }

                        // Skip Microsoft Store Python stub which causes error 193
                        if path.contains("WindowsApps") || path.contains("Microsoft\\WindowsApps") {
                            continue;
                        }

                        // Verify this is actually an executable we can run
                        if Path::new(path).exists() {
                            // Test if it works by trying to get version
                            let mut probe = Command::new(path);
                            probe.arg("--version");
                            configure_command(&mut probe);
                            if let Ok(test) = probe.output() {
                                if test.status.success() {
                                    return Ok(path.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }

        // Last resort: try "python" directly and hope the system resolves it correctly
        // This will fail at runtime if Python isn't properly installed
        return Ok("python".to_string());
    } else {
        // Unix-style paths (macOS/Linux)
        let home = std::env::var("HOME").unwrap_or_else(|_| String::from("/tmp"));
        let common_paths = vec![
            format!("{}/.pyenv/shims/python3", home),  // Check pyenv first
            "/opt/homebrew/bin/python3".to_string(),   // Then Homebrew
            "/usr/local/bin/python3".to_string(),       // Then /usr/local
            "/usr/bin/python3".to_string(),             // System Python last
        ];

        for path in &common_paths {
            if Path::new(path).exists() {
                return Ok(path.clone());
            }
        }

        // Try to find python3 in PATH as last resort
        let mut which_cmd = Command::new("which");
        which_cmd.arg("python3");
        configure_command(&mut which_cmd);
        if let Ok(output) = which_cmd.output() {
            if output.status.success() {
                if let Ok(path) = String::from_utf8(output.stdout) {
                    let path = path.trim().to_string();
                    if !path.is_empty() && Path::new(&path).exists() {
                        return Ok(path);
                    }
                }
            }
        }
    }

    // No Python found - provide helpful error message
    Err(
        "Python 3 interpreter not found. The imgstax desktop app requires \
         Python 3 with imgstax installed for development mode. Solutions: \
         (1) set IMGSTAX_PYTHON_PATH to your python3 path, \
         (2) ensure python3 is in your PATH, \
         (3) install Python 3 (macOS: brew install python3, Linux: apt install python3). \
         After installing Python, install imgstax with: pip install -e ."
            .to_string(),
    )
}

/// Get the imgstax command to run, adapting to production vs development mode.
/// Returns (command_path, base_args) to prepend before any subcommand flags.
/// - Production: (path/to/imgstax[.exe], [])
/// - Development: (python_path, ["-m", "imgstax"])
fn get_imgstax_cmd() -> Result<(String, Vec<String>), String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()));

    if let Some(dir) = exe_dir {
        let binary_name = if cfg!(target_os = "windows") {
            "imgstax.exe"
        } else {
            "imgstax"
        };
        let binary_path = dir.join(binary_name);
        if binary_path.exists() {
            return Ok((binary_path.to_string_lossy().to_string(), vec![]));
        }
    }

    // Development: fall back to Python -m imgstax
    Ok((get_python_path()?, vec!["-m".to_string(), "imgstax".to_string()]))
}

#[derive(Debug, Serialize, Deserialize)]
struct Recipe {
    name: String,
    description: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct ValidationResult {
    valid: bool,
    image_count: usize,
    error: Option<String>,
    detected_formats: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct StackConfig {
    input_path: String,
    output_path: String,
    prefix: String,
    stacking: String,
    start_frame: Option<u32>,
    end_frame: Option<u32>,
    frame_interval: u32,
    trail_length: u32,
    trail_gradient: bool,
    gradient_decay: f32,
    gradient_plateau: u32,
    fade_out: bool,
    quality: u32,
    png_compress_level: u32,
    tiff_compression: String,
    export_recipe: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct StackResult {
    success: bool,
    output_dir: String,
    error: Option<String>,
}

#[tauri::command]
fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");

    command.arg(&path);
    spawn_and_reap(&mut command, "Failed to open folder")
}

// ==================== Notification Commands ====================

#[derive(Debug, Serialize, Deserialize)]
struct SoundFile {
    name: String,
    path: String,
}

#[tauri::command]
fn get_platform() -> String {
    if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else {
        "linux".to_string()
    }
}

#[tauri::command]
fn list_system_sounds() -> Vec<SoundFile> {
    #[cfg(target_os = "macos")]
    {
        let dir = "/System/Library/Sounds/";
        let mut sounds = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    let ext = ext.to_string_lossy().to_lowercase();
                    if ext == "aiff" || ext == "aifc" {
                        if let Some(stem) = path.file_stem() {
                            sounds.push(SoundFile {
                                name: stem.to_string_lossy().to_string(),
                                path: path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }
        sounds.sort_by(|a, b| a.name.cmp(&b.name));
        sounds
    }
    #[cfg(target_os = "windows")]
    {
        let dir = r"C:\Windows\Media\";
        let mut sounds = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Some(ext) = path.extension() {
                    if ext.to_string_lossy().to_lowercase() == "wav" {
                        if let Some(stem) = path.file_stem() {
                            sounds.push(SoundFile {
                                name: stem.to_string_lossy().to_string(),
                                path: path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }
        sounds.sort_by(|a, b| a.name.cmp(&b.name));
        sounds
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Vec::new()
    }
}

#[tauri::command]
fn play_notification_sound(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("afplay");
        command.arg(&path);
        spawn_and_reap(&mut command, "Failed to play sound")
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Add-Type -AssemblyName System.Windows.Forms; \
             [System.Media.SoundPlayer]::new('{}').PlaySync()",
            path.replace('\'', "''")
        );
        let mut command = Command::new("powershell");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x08000000); // CREATE_NO_WINDOW
        spawn_and_reap(&mut command, "Failed to play sound")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = path;
        Err("Sound notifications not supported on this platform".to_string())
    }
}

#[tauri::command]
fn speak_notification(text: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("say");
        command.arg(&text);
        spawn_and_reap(&mut command, "Failed to speak")
    }
    #[cfg(target_os = "windows")]
    {
        let script = format!(
            "Add-Type -AssemblyName System.Speech; \
             (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('{}')",
            text.replace('\'', "''")
        );
        let mut command = Command::new("powershell");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x08000000); // CREATE_NO_WINDOW
        spawn_and_reap(&mut command, "Failed to speak")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = text;
        Err("Text-to-speech not supported on this platform".to_string())
    }
}

// ==================== Post-Processing Commands ====================

#[derive(Debug, Serialize, Deserialize)]
struct PostProcRecipe {
    name: String,
    description: String,
    path: String,
    is_builtin: bool,
    os: serde_json::Value,  // Can be string or array of strings
}

#[tauri::command]
async fn list_postproc_recipes() -> Result<Vec<PostProcRecipe>, String> {
    run_imgstax_json(vec!["--postproc-list".to_string()]).await
}

#[tauri::command]
async fn load_postproc_recipe(recipe_name: String) -> Result<serde_json::Value, String> {
    let recipe: serde_json::Value = run_imgstax_json(vec![
        "--postproc-get".to_string(),
        recipe_name.clone(),
    ])
    .await?;

    if recipe.is_null() {
        return Err(format!("Recipe not found: {}", recipe_name));
    }

    Ok(recipe)
}

#[tauri::command]
async fn save_postproc_recipe(recipe_json: String) -> Result<String, String> {
    run_imgstax(vec!["--postproc-save".to_string(), recipe_json]).await
}

#[tauri::command]
async fn delete_postproc_recipe(recipe_path: String) -> Result<bool, String> {
    let result = run_imgstax(vec!["--postproc-delete".to_string(), recipe_path]).await?;
    Ok(result == "true")
}

#[tauri::command]
async fn execute_postproc(
    recipe_name: String,
    working_directory: String,
    window: Window,
) -> Result<serde_json::Value, String> {
    // The body below spawns a subprocess and reads it to completion, which can
    // take minutes. Run it on a blocking thread so it never ties up an async
    // runtime worker. `Window` is Send + Clone, so emitting from here is fine.
    tauri::async_runtime::spawn_blocking(move || {
        execute_postproc_blocking(recipe_name, working_directory, window)
    })
    .await
    .map_err(|e| format!("Post-processing task failed: {}", e))?
}

fn execute_postproc_blocking(
    recipe_name: String,
    working_directory: String,
    window: Window,
) -> Result<serde_json::Value, String> {
    use std::path::PathBuf;
    use std::fs::OpenOptions;
    use std::io::Write as IoWrite;

    // Create log file path in the output directory
    let log_path = PathBuf::from(&working_directory).join("postproc.log");
    let log_path_str = log_path.to_string_lossy().to_string();

    // Build command: bundled binary in production, python -m imgstax in dev
    let (cmd, mut args) = get_imgstax_cmd()?;
    args.push("--postproc-execute".to_string());
    args.push(recipe_name.clone());
    args.push("--working-dir".to_string());
    args.push(working_directory.clone());
    args.push("--log-file".to_string());
    args.push(log_path_str.clone());

    let mut command = Command::new(&cmd);
    command.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_command(&mut command);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start post-processing: {}", e))?;

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("Failed to capture stderr")?;

    let reader = BufReader::new(stdout);
    let stderr_reader = BufReader::new(stderr);

    // Open Rust log file
    let rust_log_path = PathBuf::from(&working_directory).join("postproc_rust.log");
    let mut rust_log = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .open(&rust_log_path)
        .ok();

    if let Some(ref mut log) = rust_log {
        let _ = writeln!(log, "=== Rust Post-Processing Log ===");
        let _ = writeln!(log, "Recipe: {}", recipe_name);
        let _ = writeln!(log, "Working Directory: {}\n", working_directory);
    }

    // Collect stderr in a separate thread to prevent blocking
    let stderr_log_path = rust_log_path.clone();
    let stderr_handle = std::thread::spawn(move || {
        let mut stderr_output = String::new();
        let mut thread_log = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&stderr_log_path)
            .ok();

        if let Some(ref mut log) = thread_log {
            let _ = writeln!(log, "=== Python Process STDERR ===");
        }

        for line in stderr_reader.lines() {
            if let Ok(line) = line {
                if let Some(ref mut log) = thread_log {
                    let _ = writeln!(log, "[STDERR] {}", line);
                }
                if !stderr_output.is_empty() {
                    stderr_output.push('\n');
                }
                stderr_output.push_str(&line);
            }
        }
        stderr_output
    });

    // Stream output to frontend and capture final result
    let mut final_result: Option<serde_json::Value> = None;

    if let Some(ref mut log) = rust_log {
        let _ = writeln!(log, "=== Python Process STDOUT ===");
    }

    // Never `?` out of this loop: an early return would skip child.wait() and
    // leave a zombie. Record the failure and fall through to the cleanup below.
    let mut read_error: Option<String> = None;

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(e) => {
                read_error = Some(format!("Failed to read output: {}", e));
                break;
            }
        };

        if let Some(ref mut log) = rust_log {
            let _ = writeln!(log, "[STDOUT] {}", line);
        }

        // Try to parse as JSON progress event
        if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
            if event.get("type") == Some(&serde_json::Value::String("progress".to_string())) {
                if let Some(ref mut log) = rust_log {
                    let _ = writeln!(log, "[PARSED] Progress event");
                }
                let _ = window.emit("postproc-progress", &event);
            } else {
                if let Some(ref mut log) = rust_log {
                    let _ = writeln!(log, "[PARSED] Final result: {}", serde_json::to_string_pretty(&event).unwrap_or_default());
                }
                // Capture final result but don't return yet - need to read all output
                final_result = Some(event);
            }
        } else {
            if let Some(ref mut log) = rust_log {
                let _ = writeln!(log, "[PARSE FAILED] Could not parse as JSON");
            }
        }
    }

    // Wait for process to complete. Reached on every path out of the read loop.
    let status = child.wait().map_err(|e| format!("Failed to wait for process: {}", e))?;

    if let Some(ref mut log) = rust_log {
        let _ = writeln!(log, "\n=== Process Completed ===");
        let _ = writeln!(log, "Exit Status: {:?}", status);
    }

    // Get stderr output
    let stderr_output = stderr_handle.join().unwrap_or_else(|_| String::new());

    if let Some(ref mut log) = rust_log {
        let _ = writeln!(log, "STDERR Output Length: {}", stderr_output.len());
    }

    // If we got a final result, validate and return it
    if let Some(mut result) = final_result {
        let is_success = result.get("success").and_then(|v| v.as_bool()).unwrap_or(false);

        if let Some(ref mut log) = rust_log {
            let _ = writeln!(log, "\n=== Returning Final Result ===");
            let _ = writeln!(log, "Success: {:?}", result.get("success"));
            let _ = writeln!(log, "Return Code: {:?}", result.get("return_code"));
        }

        // Add stderr to result if it's not already included
        if !stderr_output.is_empty() && result.get("stderr").and_then(|s| s.as_str()).unwrap_or("").is_empty() {
            result["stderr"] = serde_json::Value::String(stderr_output.clone());
        }

        // Add log file paths to result for error reporting
        result["log_files"] = serde_json::json!({
            "python_log": log_path.to_string_lossy(),
            "rust_log": rust_log_path.to_string_lossy()
        });

        // If successful, delete the log files
        if is_success {
            let _ = std::fs::remove_file(&log_path);
            let _ = std::fs::remove_file(&rust_log_path);
            if let Some(ref mut log) = rust_log {
                let _ = writeln!(log, "Deleted log files (success)");
            }
        } else {
            // Add helpful error message pointing to logs
            let log_dir = PathBuf::from(&working_directory);
            result["error_message"] = serde_json::Value::String(
                format!("Error detected in post-processing output. Please check the logs in:\n{}",
                    log_dir.to_string_lossy())
            );
            if let Some(ref mut log) = rust_log {
                let _ = writeln!(log, "Keeping log files (failure detected)");
            }
        }

        // Return the result as-is - the JavaScript will check the success field
        return Ok(result);
    }

    // No JSON result received - return error with stderr if available
    if let Some(ref mut log) = rust_log {
        let _ = writeln!(log, "\n=== ERROR: No Final Result Received ===");
    }

    if let Some(err) = read_error {
        return Err(err);
    }

    if !stderr_output.is_empty() {
        return Err(format!("Post-processing failed: {}", stderr_output));
    }

    if !status.success() {
        return Err(format!("Post-processing failed with exit code: {:?}", status.code()));
    }

    Err("No result returned from post-processing".to_string())
}

// ==================== End Post-Processing Commands ====================

#[tauri::command]
async fn get_recipes() -> Result<Vec<Recipe>, String> {
    run_imgstax_json(vec!["--get-recipes-json".to_string()]).await
}

#[tauri::command]
fn validate_directory(path: String) -> Result<ValidationResult, String> {
    let dir_path = Path::new(&path);

    if !dir_path.exists() {
        return Ok(ValidationResult {
            valid: false,
            image_count: 0,
            error: Some("Directory does not exist".to_string()),
            detected_formats: vec![],
        });
    }

    if !dir_path.is_dir() {
        return Ok(ValidationResult {
            valid: false,
            image_count: 0,
            error: Some("Path is not a directory".to_string()),
            detected_formats: vec![],
        });
    }

    // Use Rust to count and validate images instead of Python (safer, no crash risk)
    let mut image_count = 0;
    let mut formats = std::collections::HashSet::new();
    let image_extensions = [
        ".jpg", ".jpeg", ".jpe", ".jfif",  // JPEG variants
        ".png",                             // PNG
        ".tif", ".tiff",                    // TIFF variants
        ".bmp", ".dib",                     // BMP variants
        ".webp",                            // WebP
        ".tga",                             // TGA
        ".ppm", ".pgm", ".pbm"              // Netpbm formats
    ];

    match fs::read_dir(dir_path) {
        Ok(entries) => {
            for entry in entries {
                if let Ok(entry) = entry {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(ext) = path.extension() {
                            let ext_lower = ext.to_string_lossy().to_lowercase();
                            let ext_str = format!(".{}", ext_lower);
                            if image_extensions.contains(&ext_str.as_str()) {
                                image_count += 1;
                                // Map to format names for GUI controls
                                if ext_str == ".jpg" || ext_str == ".jpeg" || ext_str == ".jpe" || ext_str == ".jfif" {
                                    formats.insert("jpeg".to_string());
                                } else if ext_str == ".png" {
                                    formats.insert("png".to_string());
                                } else if ext_str == ".tif" || ext_str == ".tiff" {
                                    formats.insert("tiff".to_string());
                                } else if ext_str == ".bmp" || ext_str == ".dib" {
                                    formats.insert("bmp".to_string());
                                } else if ext_str == ".webp" {
                                    formats.insert("webp".to_string());
                                } else if ext_str == ".tga" {
                                    formats.insert("tga".to_string());
                                } else if ext_str == ".ppm" || ext_str == ".pgm" || ext_str == ".pbm" {
                                    formats.insert("netpbm".to_string());
                                }
                            }
                        }
                    }
                }
            }

            if image_count == 0 {
                return Ok(ValidationResult {
                    valid: false,
                    image_count: 0,
                    error: Some("No valid images found in directory. Supported formats: JPG, PNG, TIFF".to_string()),
                    detected_formats: vec![],
                });
            }

            let mut formats_vec: Vec<String> = formats.into_iter().collect();
            formats_vec.sort();

            Ok(ValidationResult {
                valid: true,
                image_count,
                error: None,
                detected_formats: formats_vec,
            })
        }
        Err(e) => Ok(ValidationResult {
            valid: false,
            image_count: 0,
            error: Some(format!("Failed to read directory: {}", e)),
            detected_formats: vec![],
        }),
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct FileInfo {
    index: usize,
    filename: String,
    path: String,
}

#[tauri::command]
fn get_file_list(app: tauri::AppHandle, path: String) -> Result<Vec<FileInfo>, String> {
    // Use Rust to get file list instead of Python (safer, no crash risk)
    let dir_path = Path::new(&path);

    // This is the only command that hands image paths to the webview, so it is
    // also where the asset protocol earns access to them. The static scope in
    // tauri.conf.json is empty; each directory the user explicitly opens is
    // added here, for this session only.
    //
    // The pattern must be canonical: Scope::is_allowed canonicalizes the
    // requested path, but allow_directory stores what it is given verbatim, so
    // an uncanonicalized "/tmp/frames" would never match "/private/tmp/frames".
    // `false` keeps the grant to this directory's own files, matching the
    // non-recursive listing below.
    let canonical_dir = dir_path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve directory: {}", e))?;
    app.asset_protocol_scope()
        .allow_directory(&canonical_dir, false)
        .map_err(|e| format!("Failed to grant preview access to directory: {}", e))?;
    let image_extensions = [
        ".jpg", ".jpeg", ".jpe", ".jfif",  // JPEG variants
        ".png",                             // PNG
        ".tif", ".tiff",                    // TIFF variants
        ".bmp", ".dib",                     // BMP variants
        ".webp",                            // WebP
        ".tga",                             // TGA
        ".ppm", ".pgm", ".pbm"              // Netpbm formats
    ];
    let mut files = Vec::new();

    match fs::read_dir(dir_path) {
        Ok(entries) => {
            // Collect all image files
            let mut image_paths: Vec<std::path::PathBuf> = Vec::new();
            for entry in entries {
                if let Ok(entry) = entry {
                    let entry_path = entry.path();
                    if entry_path.is_file() {
                        if let Some(ext) = entry_path.extension() {
                            let ext_lower = ext.to_string_lossy().to_lowercase();
                            let ext_str = format!(".{}", ext_lower);
                            if image_extensions.contains(&ext_str.as_str()) {
                                image_paths.push(entry_path);
                            }
                        }
                    }
                }
            }

            // Sort by filename (case-insensitive)
            image_paths.sort_by(|a, b| {
                let a_name = a.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                let b_name = b.file_name().unwrap_or_default().to_string_lossy().to_lowercase();
                a_name.cmp(&b_name)
            });

            // Build FileInfo list
            for (index, img_path) in image_paths.iter().enumerate() {
                // Keep native path format - convertFileSrc() expects it
                let path_str = img_path.to_string_lossy().to_string();

                files.push(FileInfo {
                    index,
                    filename: img_path.file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                    path: path_str,
                });
            }

            Ok(files)
        }
        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct UserRecipeInfo {
    id: String,
    name: String,
    description: String,
}

#[tauri::command]
fn list_user_recipes(app: tauri::AppHandle) -> Result<Vec<UserRecipeInfo>, String> {
    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    let recipes_dir = config_dir.join("user_recipes");

    // Create directory if it doesn't exist
    if !recipes_dir.exists() {
        fs::create_dir_all(&recipes_dir)
            .map_err(|e| format!("Failed to create recipes directory: {}", e))?;
        return Ok(vec![]);
    }

    let mut recipes = vec![];

    // Read all .yaml files in the directory
    let entries = fs::read_dir(&recipes_dir)
        .map_err(|e| format!("Failed to read recipes directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("yaml") {
            // One unreadable or malformed file must not hide every valid recipe,
            // so skip it with a warning rather than failing the whole listing.
            let content = match fs::read_to_string(&path) {
                Ok(content) => content,
                Err(e) => {
                    eprintln!("Skipping unreadable recipe {}: {}", path.display(), e);
                    continue;
                }
            };

            // Parse YAML to get name and description
            let yaml: serde_yaml::Value = match serde_yaml::from_str(&content) {
                Ok(yaml) => yaml,
                Err(e) => {
                    eprintln!("Skipping malformed recipe {}: {}", path.display(), e);
                    continue;
                }
            };

            let id = path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();

            let name = yaml.get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&id)
                .to_string();

            let description = yaml.get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            recipes.push(UserRecipeInfo { id, name, description });
        }
    }

    // Sort by name for consistent ordering
    recipes.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(recipes)
}

#[tauri::command]
fn load_user_recipe(app: tauri::AppHandle, recipe_id: String) -> Result<String, String> {
    // Validate recipe ID to prevent path traversal
    validate_recipe_id(&recipe_id)?;

    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    let recipe_path = config_dir.join("user_recipes").join(format!("{}.yaml", recipe_id));

    if !recipe_path.exists() {
        return Err(format!("Recipe '{}' not found", recipe_id));
    }

    fs::read_to_string(&recipe_path)
        .map_err(|e| format!("Failed to read recipe: {}", e))
}

#[tauri::command]
fn save_user_recipe(app: tauri::AppHandle, recipe_id: String, content: String) -> Result<(), String> {
    // Validate recipe ID to prevent path traversal
    validate_recipe_id(&recipe_id)?;

    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    let recipes_dir = config_dir.join("user_recipes");

    // Create directory if it doesn't exist
    if !recipes_dir.exists() {
        fs::create_dir_all(&recipes_dir)
            .map_err(|e| format!("Failed to create recipes directory: {}", e))?;
    }

    let recipe_path = recipes_dir.join(format!("{}.yaml", recipe_id));

    fs::write(&recipe_path, content)
        .map_err(|e| format!("Failed to write recipe: {}", e))
}

#[tauri::command]
fn delete_user_recipe(app: tauri::AppHandle, recipe_id: String) -> Result<(), String> {
    // Validate recipe ID to prevent path traversal
    validate_recipe_id(&recipe_id)?;

    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    let recipe_path = config_dir.join("user_recipes").join(format!("{}.yaml", recipe_id));

    if !recipe_path.exists() {
        return Err(format!("Recipe '{}' not found", recipe_id));
    }

    fs::remove_file(&recipe_path)
        .map_err(|e| format!("Failed to delete recipe: {}", e))
}

#[tauri::command]
fn export_user_recipe(app: tauri::AppHandle, recipe_id: String, export_path: String) -> Result<(), String> {
    // Validate recipe ID to prevent path traversal
    validate_recipe_id(&recipe_id)?;

    let config_dir = app.path().app_config_dir()
        .map_err(|e| format!("Failed to get config directory: {}", e))?;

    let recipe_path = config_dir.join("user_recipes").join(format!("{}.yaml", recipe_id));

    if !recipe_path.exists() {
        return Err(format!("Recipe '{}' not found", recipe_id));
    }

    let content = fs::read_to_string(&recipe_path)
        .map_err(|e| format!("Failed to read recipe: {}", e))?;

    fs::write(&export_path, content)
        .map_err(|e| format!("Failed to write export file: {}", e))
}

#[tauri::command]
fn import_user_recipe_from_file(import_path: String) -> Result<String, String> {
    let path = Path::new(&import_path);

    if !path.exists() {
        return Err(format!("Import file '{}' not found", import_path));
    }

    fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read import file: {}", e))
}

#[tauri::command]
fn cancel_stacking() -> Result<(), String> {
    // Hold the lock across the signal. `start_stacking` must take the child out
    // of this slot before it can reap it, so while we hold the lock the handle
    // is live and its PID cannot have been recycled by the OS.
    let mut slot = STACKING_PROCESS.lock()
        .map_err(|e| format!("Failed to acquire process lock: {}", e))?;

    let child = match slot.as_mut() {
        Some(child) => child,
        None => return Err("No stacking process is currently running".to_string()),
    };

    #[cfg(unix)]
    {
        // SIGTERM rather than SIGKILL, so a future signal handler in the Python
        // side could finish writing the current frame before exiting.
        let pid = child.id() as libc::pid_t;
        if unsafe { libc::kill(pid, libc::SIGTERM) } != 0 {
            let err = std::io::Error::last_os_error();
            eprintln!("SIGTERM to stacking process failed: {}", err);
            // Fall back to an unconditional kill.
            child.kill().map_err(|e| format!("Failed to stop stacking process: {}", e))?;
        }
    }

    #[cfg(windows)]
    {
        // The bundled binary is a PyInstaller one-file build: the process we
        // spawned is the bootloader, which re-execs the real interpreter as a
        // child of its own. `Child::kill` is TerminateProcess on the bootloader
        // alone and would strand that grandchild, so kill the tree with
        // taskkill. Taking the PID from the handle we still own (and still hold
        // the lock on) keeps the PID-reuse protection that the old
        // PID-in-a-global version lacked.
        let pid = child.id();
        let killed_tree = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
            .map(|out| out.status.success())
            .unwrap_or(false);

        if !killed_tree {
            child.kill().map_err(|e| format!("Failed to stop stacking process: {}", e))?;
        }
    }

    #[cfg(not(any(unix, windows)))]
    {
        child.kill().map_err(|e| format!("Failed to stop stacking process: {}", e))?;
    }

    // The slot is deliberately left populated: `start_stacking` owns the
    // reaping, and clearing it here would leak a zombie on Unix.
    Ok(())
}

#[tauri::command]
async fn start_stacking(config: StackConfig, window: tauri::Window) -> Result<StackResult, String> {
    // A stack runs for minutes; keep it off the async runtime's workers.
    tauri::async_runtime::spawn_blocking(move || start_stacking_blocking(config, window))
        .await
        .map_err(|e| format!("Stacking task failed: {}", e))?
}

fn start_stacking_blocking(
    config: StackConfig,
    window: tauri::Window,
) -> Result<StackResult, String> {
    // Construct absolute output path
    let repo_root = env!("CARGO_MANIFEST_DIR").to_string() + "/../..";
    let output_abs = if Path::new(&config.output_path).is_absolute() {
        config.output_path.clone()
    } else {
        Path::new(&repo_root)
            .join(&config.output_path)
            .canonicalize()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| config.output_path.clone())
    };

    // Build command arguments (same for both sidecar and Python)
    let mut base_args = vec![
        config.input_path.clone(),
        "-o".to_string(),
        config.output_path.clone(),
        "-p".to_string(),
        config.prefix.clone(),
        "-s".to_string(),
        config.stacking.clone(),
        "-q".to_string(),
        config.quality.to_string(),
        "--png-compress-level".to_string(),
        config.png_compress_level.to_string(),
        "--tiff-compression".to_string(),
        config.tiff_compression.clone(),
    ];

    if let Some(start_frame) = config.start_frame {
        base_args.push("--start-frame".to_string());
        base_args.push(start_frame.to_string());
    }

    if let Some(end_frame) = config.end_frame {
        base_args.push("--end-frame".to_string());
        base_args.push(end_frame.to_string());
    }

    if config.frame_interval > 1 {
        base_args.push("--frame-interval".to_string());
        base_args.push(config.frame_interval.to_string());
    }

    if config.trail_length > 0 {
        base_args.push("-t".to_string());
        base_args.push(config.trail_length.to_string());
    }

    if config.trail_gradient {
        base_args.push("-g".to_string());
        base_args.push("--gradient-decay".to_string());
        base_args.push(config.gradient_decay.to_string());
        base_args.push("--gradient-plateau".to_string());
        base_args.push(config.gradient_plateau.to_string());
    }

    if config.fade_out {
        base_args.push("-f".to_string());
    }

    // Add progress JSON flag for GUI
    base_args.push("--progress-json".to_string());

    // Get the command to execute (bundled binary or Python)
    let (cmd_path, mut args) = get_imgstax_cmd()?;
    args.extend(base_args);

    // Refuse to start a second job rather than orphaning the first. Checked
    // before the spawn so a rejected start leaves no stray process behind.
    let mut slot = STACKING_PROCESS.lock()
        .map_err(|e| format!("Failed to acquire process lock: {}", e))?;
    if slot.is_some() {
        return Err("A stacking job is already running".to_string());
    }

    // Execute command with std::process::Command
    let mut command = Command::new(&cmd_path);
    command
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_command(&mut command);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to execute stacking: {} (command: {})", e, cmd_path))?;

    // Reap the child rather than leaking it if either pipe is missing; the slot
    // has not been populated yet, so nothing else will clean it up.
    let (stdout, stderr) = match (child.stdout.take(), child.stderr.take()) {
        (Some(stdout), Some(stderr)) => (stdout, stderr),
        _ => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Failed to capture stacking process output".to_string());
        }
    };
    let reader = BufReader::new(stdout);

    // Hand the child to the global slot so cancel_stacking can signal it.
    *slot = Some(child);
    drop(slot);

    // Collect stderr in a background thread to prevent deadlock
    let stderr_handle = std::thread::spawn(move || {
        let mut output = String::new();
        for line in BufReader::new(stderr).lines() {
            if let Ok(line) = line {
                output.push_str(&line);
                output.push('\n');
            }
        }
        output
    });

    // Read JSON lines and emit progress to frontend. Never `?` out of this loop:
    // the child still has to be reaped and the global slot cleared below.
    let mut read_error: Option<String> = None;
    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(e) => {
                read_error = Some(format!("Failed to read output: {}", e));
                break;
            }
        };
        match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(progress) => {
                let _ = window.emit("stacking-progress", &progress);
            }
            // Anything the Python side prints that isn't a progress event (most
            // often a warning) used to be discarded silently.
            Err(_) => eprintln!("[imgstax] {}", line),
        }
    }

    // Reclaim the child and reap it. Reached on every path out of the read loop,
    // including a cancel, so no zombie is left and a new stack can start.
    let mut child = STACKING_PROCESS.lock()
        .map_err(|e| format!("Failed to acquire process lock: {}", e))?
        .take()
        .ok_or("Stacking process handle went missing")?;

    let status = child.wait().map_err(|e| format!("Failed to wait for process: {}", e))?;
    let stderr_output = stderr_handle.join().unwrap_or_default();

    if let Some(err) = read_error {
        return Err(err);
    }

    if !status.success() {
        // Write error log to the output directory for debugging
        use std::io::Write as IoWrite;
        let log_path = Path::new(&config.output_path).join("stacking_error.log");
        if let Ok(mut log_file) = fs::File::create(&log_path) {
            let _ = writeln!(log_file, "=== imgstax Stacking Error Log ===");
            let _ = writeln!(log_file, "Input:  {}", config.input_path);
            let _ = writeln!(log_file, "Output: {}", config.output_path);
            let _ = writeln!(log_file, "Exit status: {:?}", status.code());
            let _ = writeln!(log_file, "\n=== Process Output ===");
            let _ = writeln!(log_file, "{}", if stderr_output.is_empty() { "(no output)" } else { &stderr_output });
        }

        let error_detail = if !stderr_output.is_empty() {
            format!("Stacking failed:\n{}", stderr_output.trim())
        } else {
            format!("Stacking failed with exit code {:?}. Check stacking_error.log in the output directory.", status.code())
        };

        return Ok(StackResult {
            success: false,
            output_dir: config.output_path.clone(),
            error: Some(error_detail),
        });
    }

    // Export recipe.yaml if requested
    if config.export_recipe {
        let recipe_path = Path::new(&output_abs).join("recipe.yaml");

        // Build recipe YAML content. Settings must be nested under a
        // `settings:` key — the Python recipe loader reads data['settings'].
        let mut recipe_content = format!(
            "# imgstax Recipe\n\
             # Generated automatically with exported images\n\
             \n\
             name: Exported Recipe\n\
             description: Configuration used for this stacking export\n\
             \n\
             settings:\n\
             \x20 stacking: {}\n\
             \x20 quality: {}\n\
             \x20 png_compress_level: {}\n\
             \x20 tiff_compression: {}\n",
            config.stacking,
            config.quality,
            config.png_compress_level,
            config.tiff_compression
        );

        // Add optional parameters if they were set
        if let Some(start_frame) = config.start_frame {
            recipe_content.push_str(&format!("  start_frame: {}\n", start_frame));
        }
        if let Some(end_frame) = config.end_frame {
            recipe_content.push_str(&format!("  end_frame: {}\n", end_frame));
        }
        if config.frame_interval > 1 {
            recipe_content.push_str(&format!("  frame_interval: {}\n", config.frame_interval));
        }
        if config.trail_length > 0 {
            recipe_content.push_str(&format!("  trail_length: {}\n", config.trail_length));
        }
        if config.trail_gradient {
            recipe_content.push_str("  trail_gradient: true\n");
            recipe_content.push_str(&format!("  gradient_decay: {}\n", config.gradient_decay));
            recipe_content.push_str(&format!("  gradient_plateau: {}\n", config.gradient_plateau));
        }
        if config.fade_out {
            recipe_content.push_str("  fade_out: true\n");
        }

        // Write recipe file
        if let Err(e) = fs::write(&recipe_path, recipe_content) {
            eprintln!("Warning: Failed to write recipe.yaml: {}", e);
            // Don't fail the entire operation if recipe export fails
        }
    }

    Ok(StackResult {
        success: true,
        output_dir: output_abs,
        error: None,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
        get_app_version,
        get_recipes,
        validate_directory,
        get_file_list,
        list_user_recipes,
        load_user_recipe,
        save_user_recipe,
        delete_user_recipe,
        export_user_recipe,
        import_user_recipe_from_file,
        list_postproc_recipes,
        load_postproc_recipe,
        save_postproc_recipe,
        delete_postproc_recipe,
        execute_postproc,
        start_stacking,
        cancel_stacking,
        open_folder,
        get_platform,
        list_system_sounds,
        play_notification_sound,
        speak_notification
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
