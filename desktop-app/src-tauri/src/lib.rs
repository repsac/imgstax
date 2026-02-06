use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::fs;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

// Global storage for the stacking process handle
static STACKING_PROCESS: once_cell::sync::Lazy<Arc<Mutex<Option<u32>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(Mutex::new(None)));

/// Get the Python interpreter path.
/// In development, uses the system Python.
/// In production, this won't be used as we'll have the bundled binary.
fn get_python_path() -> String {
    "/Users/edcaspersen/.pyenv/versions/3.12.8/bin/python3".to_string()
}

/// Get the path to the imgstax executable.
/// In development, uses the system Python with -m imgstax.
/// In production, uses the bundled imgstax binary.
fn get_imgstax_command() -> (String, Vec<String>) {
    // Check if we have a bundled binary
    let resource_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|p| p.to_path_buf()));

    if let Some(dir) = resource_dir {
        // Look for bundled binary in same directory as executable
        let binary_name = if cfg!(target_os = "windows") {
            "imgstax.exe"
        } else {
            "imgstax"
        };

        let bundled_path = dir.join(binary_name);
        if bundled_path.exists() {
            // Production: use bundled binary
            return (bundled_path.to_string_lossy().to_string(), vec![]);
        }
    }

    // Development: use Python with -m imgstax
    // This allows for rapid iteration without rebuilding the binary
    (get_python_path(), vec!["-m".to_string(), "imgstax".to_string()])
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
    {
        Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
fn get_recipes() -> Result<Vec<Recipe>, String> {
    // Call Python to get recipe list
    let output = Command::new(get_python_path())
        .arg("-c")
        .arg(r#"
import sys
import json
sys.path.insert(0, '../..')
from imgstax.recipe_loader import get_recipe_details
recipes = get_recipe_details()
print(json.dumps(recipes))
"#)
        .output()
        .map_err(|e| format!("Failed to execute Python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let recipes: Vec<Recipe> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse recipes: {}", e))?;

    Ok(recipes)
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

    // Call Python to count images
    // Escape the path properly for Python
    let escaped_path = path.replace("\\", "\\\\").replace("'", "\\'");

    let output = Command::new(get_python_path())
        .arg("-c")
        .arg(format!(r#"
import sys
import os
import io
import json
from pathlib import Path
# Redirect stdout to capture log messages
real_stdout = sys.stdout
sys.stdout = io.StringIO()
# Import and run with stdout redirected
sys.path.insert(0, os.getcwd())
from imgstax.file_utils import find_input_images
images = find_input_images(Path(r'{}'))
# Detect unique file formats
formats = set()
for img in images:
    ext = img.suffix.lower()
    if ext in ['.jpg', '.jpeg']:
        formats.add('jpeg')
    elif ext == '.png':
        formats.add('png')
    elif ext in ['.tif', '.tiff']:
        formats.add('tiff')
# Restore stdout and print JSON result
sys.stdout = real_stdout
result = {{'count': len(images), 'formats': sorted(list(formats))}}
print(json.dumps(result))
"#, escaped_path))
        .current_dir(env!("CARGO_MANIFEST_DIR").to_string() + "/../..")
        .output()
        .map_err(|e| format!("Failed to execute Python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Ok(ValidationResult {
            valid: false,
            image_count: 0,
            error: Some(format!("Python error:\nstderr: {}\nstdout: {}", stderr, stdout)),
            detected_formats: vec![],
        });
    }

    let result_str = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Parse JSON result
    #[derive(Deserialize)]
    struct PythonResult {
        count: usize,
        formats: Vec<String>,
    }

    match serde_json::from_str::<PythonResult>(&result_str) {
        Ok(result) => Ok(ValidationResult {
            valid: true,
            image_count: result.count,
            error: None,
            detected_formats: result.formats,
        }),
        Err(_) => {
            // Fallback to old behavior if JSON parsing fails
            let count: usize = result_str.parse().unwrap_or(0);
            Ok(ValidationResult {
                valid: true,
                image_count: count,
                error: None,
                detected_formats: vec![],
            })
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct FileInfo {
    index: usize,
    filename: String,
    path: String,
}

#[tauri::command]
fn get_file_list(path: String) -> Result<Vec<FileInfo>, String> {
    // Escape the path properly for Python
    let escaped_path = path.replace("\\", "\\\\").replace("'", "\\'");

    let output = Command::new(get_python_path())
        .arg("-c")
        .arg(format!(r#"
import sys
import os
import io
import json
from pathlib import Path
# Redirect stdout to capture log messages
real_stdout = sys.stdout
sys.stdout = io.StringIO()
# Import and run with stdout redirected
sys.path.insert(0, os.getcwd())
from imgstax.file_utils import find_input_images
images = find_input_images(Path(r'{}'))
# Restore stdout and print JSON
sys.stdout = real_stdout
files = []
for idx, img in enumerate(images):
    files.append({{"index": idx, "filename": img.name, "path": str(img)}})
print(json.dumps(files))
"#, escaped_path))
        .current_dir(env!("CARGO_MANIFEST_DIR").to_string() + "/../..")
        .output()
        .map_err(|e| format!("Failed to execute Python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Python error: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let files: Vec<FileInfo> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse file list: {}", e))?;

    Ok(files)
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
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read recipe file: {}", e))?;

            // Parse YAML to get name and description
            let yaml: serde_yaml::Value = serde_yaml::from_str(&content)
                .map_err(|e| format!("Failed to parse YAML: {}", e))?;

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
    let mut process_lock = STACKING_PROCESS.lock()
        .map_err(|e| format!("Failed to acquire process lock: {}", e))?;

    if let Some(pid) = *process_lock {
        #[cfg(unix)]
        {
            // On Unix systems (macOS, Linux), use kill command
            use std::process::Command;
            let _ = Command::new("kill")
                .arg("-TERM")
                .arg(pid.to_string())
                .output();
        }

        #[cfg(windows)]
        {
            // On Windows, use taskkill command
            use std::process::Command;
            let _ = Command::new("taskkill")
                .args(&["/PID", &pid.to_string(), "/F"])
                .output();
        }

        *process_lock = None;
        Ok(())
    } else {
        Err("No stacking process is currently running".to_string())
    }
}

#[tauri::command]
async fn start_stacking(config: StackConfig, window: tauri::Window) -> Result<StackResult, String> {
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

    // Get imgstax command (bundled binary or Python in dev)
    let (imgstax_cmd, mut base_args) = get_imgstax_command();

    // Build command arguments
    base_args.extend(vec![
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
    ]);

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

    // Execute stacking with streaming output
    let mut child = Command::new(&imgstax_cmd)
        .args(&base_args)
        .current_dir(env!("CARGO_MANIFEST_DIR").to_string() + "/../..")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to execute stacking: {}", e))?;

    // Store the process ID for potential cancellation
    let pid = child.id();
    {
        let mut process_lock = STACKING_PROCESS.lock()
            .map_err(|e| format!("Failed to acquire process lock: {}", e))?;
        *process_lock = Some(pid);
    }

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let reader = BufReader::new(stdout);

    // Read JSON lines and emit progress to frontend
    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read output: {}", e))?;
        if let Ok(progress) = serde_json::from_str::<serde_json::Value>(&line) {
            let _ = window.emit("stacking-progress", &progress);
        }
    }

    let status = child.wait().map_err(|e| format!("Failed to wait for process: {}", e))?;

    // Clear the process ID from storage since it's done
    {
        let mut process_lock = STACKING_PROCESS.lock()
            .map_err(|e| format!("Failed to acquire process lock: {}", e))?;
        *process_lock = None;
    }

    if !status.success() {
        return Ok(StackResult {
            success: false,
            output_dir: String::new(),
            error: Some("Stacking failed or was cancelled".to_string()),
        });
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
    .plugin(tauri_plugin_fs::init())
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
        start_stacking,
        cancel_stacking,
        open_folder
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
