use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::io::{BufRead, BufReader};
use std::path::Path;
use tauri::Emitter;

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
    let output = Command::new("/Users/edcaspersen/.pyenv/versions/3.12.8/bin/python3")
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
        });
    }

    if !dir_path.is_dir() {
        return Ok(ValidationResult {
            valid: false,
            image_count: 0,
            error: Some("Path is not a directory".to_string()),
        });
    }

    // Call Python to count images
    // Escape the path properly for Python
    let escaped_path = path.replace("\\", "\\\\").replace("'", "\\'");

    let output = Command::new("/Users/edcaspersen/.pyenv/versions/3.12.8/bin/python3")
        .arg("-c")
        .arg(format!(r#"
import sys
import os
import io
from pathlib import Path
# Redirect stdout to capture log messages
real_stdout = sys.stdout
sys.stdout = io.StringIO()
# Import and run with stdout redirected
sys.path.insert(0, os.getcwd())
from imgstax.file_utils import find_input_images
images = find_input_images(Path(r'{}'))
# Restore stdout and print only the count
sys.stdout = real_stdout
print(len(images))
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
        });
    }

    let count_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let count: usize = count_str.parse().unwrap_or(0);

    Ok(ValidationResult {
        valid: true,
        image_count: count,
        error: None,
    })
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

    // Build Python command to run stacking
    let mut args = vec![
        "-m".to_string(),
        "imgstax".to_string(),
        config.input_path.clone(),
        "-o".to_string(),
        config.output_path.clone(),
        "-p".to_string(),
        config.prefix.clone(),
        "-s".to_string(),
        config.stacking.clone(),
        "-q".to_string(),
        config.quality.to_string(),
    ];

    if let Some(start_frame) = config.start_frame {
        args.push("--start-frame".to_string());
        args.push(start_frame.to_string());
    }

    if let Some(end_frame) = config.end_frame {
        args.push("--end-frame".to_string());
        args.push(end_frame.to_string());
    }

    if config.frame_interval > 1 {
        args.push("--frame-interval".to_string());
        args.push(config.frame_interval.to_string());
    }

    if config.trail_length > 0 {
        args.push("-t".to_string());
        args.push(config.trail_length.to_string());
    }

    if config.trail_gradient {
        args.push("-g".to_string());
        args.push("--gradient-decay".to_string());
        args.push(config.gradient_decay.to_string());
        args.push("--gradient-plateau".to_string());
        args.push(config.gradient_plateau.to_string());
    }

    if config.fade_out {
        args.push("-f".to_string());
    }

    // Add progress JSON flag for GUI
    args.push("--progress-json".to_string());

    // Execute stacking with streaming output
    let mut child = Command::new("/Users/edcaspersen/.pyenv/versions/3.12.8/bin/python3")
        .args(&args)
        .current_dir(env!("CARGO_MANIFEST_DIR").to_string() + "/../..")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to execute stacking: {}", e))?;

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

    if !status.success() {
        return Ok(StackResult {
            success: false,
            output_dir: String::new(),
            error: Some("Stacking failed".to_string()),
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
        start_stacking,
        open_folder
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
