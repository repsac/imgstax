#!/usr/bin/env python3
"""
start-desktop.py - Cross-platform launcher for imgstax desktop app

This script launches the Tauri desktop application for imgstax.
Works on Windows, macOS, and Linux.

Requirements:
    - Node.js and npm installed
    - Rust and cargo installed
    - Desktop app dependencies installed (npm install in desktop-app/)
"""

import sys
import subprocess
import os
from pathlib import Path


def check_node():
    """Check if Node.js is installed."""
    try:
        # On Windows, try both node and node.exe
        node_cmd = 'node.exe' if sys.platform == 'win32' else 'node'
        result = subprocess.run(
            [node_cmd, '--version'],
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode == 0:
            return True
    except FileNotFoundError:
        # Try without .exe on Windows as fallback
        if sys.platform == 'win32':
            try:
                result = subprocess.run(
                    ['node', '--version'],
                    capture_output=True,
                    text=True,
                    check=False
                )
                if result.returncode == 0:
                    return True
            except FileNotFoundError:
                pass

    print("Error: Node.js not found")
    print()
    print("Please install Node.js:")
    print("  macOS:   brew install node")
    print("  Windows: https://nodejs.org/")
    print("  Linux:   apt install nodejs npm")
    return False


def check_cargo():
    """Check if Rust/Cargo is installed."""
    # Check in PATH first
    try:
        cargo_cmd = 'cargo.exe' if sys.platform == 'win32' else 'cargo'
        result = subprocess.run(
            [cargo_cmd, '--version'],
            capture_output=True,
            text=True,
            check=False
        )
        if result.returncode == 0:
            return True
    except FileNotFoundError:
        # Try without .exe on Windows as fallback
        if sys.platform == 'win32':
            try:
                result = subprocess.run(
                    ['cargo', '--version'],
                    capture_output=True,
                    text=True,
                    check=False
                )
                if result.returncode == 0:
                    return True
            except FileNotFoundError:
                pass

    # Try cargo in home directory
    cargo_ext = '.exe' if sys.platform == 'win32' else ''
    cargo_path = Path.home() / '.cargo' / 'bin' / f'cargo{cargo_ext}'
    if cargo_path.exists():
        # Add to PATH for this session
        cargo_bin = str(cargo_path.parent)
        path_sep = ';' if sys.platform == 'win32' else ':'
        os.environ['PATH'] = f"{cargo_bin}{path_sep}{os.environ.get('PATH', '')}"
        return True

    print("Error: Rust/Cargo not found")
    print()
    print("Please install Rust:")
    print("  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh")
    return False


def main():
    """Main entry point."""
    print("🚀 Starting imgstax desktop app...")
    print()

    # Check dependencies
    if not check_node():
        return 1

    if not check_cargo():
        return 1

    # Get repository root (parent of utils directory)
    repo_root = Path(__file__).parent.parent
    desktop_app_dir = repo_root / 'desktop-app'

    if not desktop_app_dir.exists():
        print(f"Error: Desktop app directory not found at {desktop_app_dir}")
        return 1

    print("📦 Launching Tauri development server...")
    print("   (First launch may take a while to compile)")
    print()
    print("Press Ctrl+C to stop the app")
    print()

    # Launch desktop app
    try:
        # On Windows, use npm.cmd instead of npm
        npm_cmd = 'npm.cmd' if sys.platform == 'win32' else 'npm'
        result = subprocess.run(
            [npm_cmd, 'run', 'dev'],
            cwd=desktop_app_dir,
            check=False
        )
        return result.returncode

    except KeyboardInterrupt:
        print()
        print("👋 App stopped")
        return 0
    except Exception as e:
        print(f"Error: {e}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
