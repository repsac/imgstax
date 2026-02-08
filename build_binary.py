#!/usr/bin/env python3
"""
Build standalone imgstax binary using PyInstaller.

This creates a single executable that can be bundled with the Tauri desktop app.
Run from the project root: python build_binary.py
"""

import sys
import subprocess
import shutil
from pathlib import Path

def build_binary():
    """Build standalone imgstax binary with PyInstaller."""

    # Check if PyInstaller is installed
    try:
        import PyInstaller
    except ImportError:
        print("PyInstaller not found. Installing...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])

    # Clean previous builds
    dist_dir = Path("dist")
    build_dir = Path("build")

    if dist_dir.exists() and (dist_dir / "imgstax").exists():
        print("Cleaning previous builds...")
        shutil.rmtree(dist_dir / "imgstax", ignore_errors=True)

    if build_dir.exists():
        shutil.rmtree(build_dir, ignore_errors=True)

    # PyInstaller command
    cmd = [
        sys.executable,
        "-m", "PyInstaller",
        "--name=imgstax",
        "--onefile",  # Single executable
        "--console",  # CLI app
        "--add-data", "imgstax/recipes:imgstax/recipes",  # Include recipes
        "imgstax/__main__.py",  # Entry point (use __main__.py for proper package imports)
    ]

    print("Building imgstax binary with PyInstaller...")
    print(f"Command: {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print("Build failed!")
        print(result.stdout)
        print(result.stderr)
        sys.exit(1)

    print("\n✓ Build successful!")

    # PyInstaller binary naming
    import platform
    system = platform.system().lower()
    arch = platform.machine().lower()

    # Check for binary with correct extension
    binary_name = "imgstax.exe" if system == "windows" else "imgstax"
    binary_path = dist_dir / binary_name

    if binary_path.exists():
        print(f"Binary created at: {binary_path}")
        print(f"Size: {binary_path.stat().st_size / 1024 / 1024:.2f} MB")

        # Copy to desktop-app resources
        desktop_bin_dir = Path("desktop-app/src-tauri/binaries")
        desktop_bin_dir.mkdir(parents=True, exist_ok=True)

        # Tauri target naming convention (use Rust target triples)
        # Map Python's platform.machine() to Rust target arch
        rust_arch = arch
        if arch == "arm64":
            rust_arch = "aarch64"  # macOS Apple Silicon
        elif arch == "amd64" or arch == "x86_64":
            rust_arch = "x86_64"

        if system == "darwin":
            target_name = f"imgstax-{rust_arch}-apple-darwin"
        elif system == "windows":
            target_name = f"imgstax-{rust_arch}-pc-windows-msvc.exe"
        elif system == "linux":
            target_name = f"imgstax-{rust_arch}-unknown-linux-gnu"
        else:
            target_name = "imgstax"

        target_path = desktop_bin_dir / target_name
        shutil.copy2(binary_path, target_path)

        print(f"\n✓ Copied binary to: {target_path}")
        print("\nNext steps:")
        print("1. Update desktop-app/src-tauri/tauri.conf.json to include the binary")
        print("2. Update lib.rs to use the bundled binary instead of hardcoded Python path")
        print("3. Run: cd desktop-app && npm run tauri build")
    else:
        print("Error: Binary not found after build")
        sys.exit(1)


if __name__ == "__main__":
    build_binary()
