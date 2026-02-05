# Building imgstax Desktop App

This guide covers building the imgstax desktop application for distribution.

## Prerequisites

- Python 3.8+
- Node.js 18+
- Rust 1.77.2+
- Tauri CLI

## Build Process

### 1. Build the imgstax Binary

First, create a standalone imgstax executable using PyInstaller:

```bash
# From project root
python build_binary.py
```

This will:
- Install PyInstaller if needed
- Create a standalone `imgstax` executable in `dist/imgstax`
- Copy the binary to `desktop-app/src-tauri/binaries/` with the correct platform-specific name
- Include all Python dependencies and recipe files

### 2. Build the Desktop App

Once the binary is built, create the Tauri app:

```bash
cd desktop-app
npm install  # If not already done
npm run tauri build
```

This will create platform-specific installers in `desktop-app/src-tauri/target/release/bundle/`:

- **macOS**: `.dmg` and `.app` in `macos/`
- **Windows**: `.exe` and `.msi` in `nsis/` and `msi/`
- **Linux**: `.deb`, `.AppImage`, `.rpm` in respective folders

### 3. Distribution

The generated installers are self-contained and can be distributed directly to users. No Python installation required!

## Development vs. Production

**Development**: Currently uses hardcoded Python path for rapid iteration
**Production**: Uses bundled imgstax binary (requires running `build_binary.py` first)

## Platform-Specific Notes

### macOS
- Binary format: `imgstax-{arch}-apple-darwin`
- Requires code signing for distribution outside App Store
- Example: `imgstax-aarch64-apple-darwin` (M1/M2) or `imgstax-x86_64-apple-darwin` (Intel)

### Windows
- Binary format: `imgstax-{arch}-pc-windows-msvc.exe`
- May require Windows Defender exclusion during development
- Example: `imgstax-x86_64-pc-windows-msvc.exe`

### Linux
- Binary format: `imgstax-{arch}-unknown-linux-gnu`
- AppImage is most portable format
- Example: `imgstax-x86_64-unknown-linux-gnu`

## Troubleshooting

**PyInstaller build fails**
- Ensure all dependencies are installed: `pip install -r requirements.txt`
- Check Python version compatibility

**Tauri build fails**
- Run `build_binary.py` first to create the bundled executable
- Verify binary exists in `desktop-app/src-tauri/binaries/`
- Check Rust toolchain: `rustup update`

**Binary too large**
- PyInstaller bundles all dependencies
- Typical size: 40-80 MB (includes Python runtime, NumPy, Pillow, etc.)
- This is normal for standalone Python apps

## CI/CD

For automated builds, run both steps in sequence:

```bash
python build_binary.py && cd desktop-app && npm run tauri build
```

Consider using GitHub Actions with matrix builds for multi-platform distribution.
