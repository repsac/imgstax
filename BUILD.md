# Building imgstax Desktop App

This guide covers building the imgstax desktop application for distribution.

## Prerequisites

- Python 3.8+
- Node.js 18+
- Rust 1.77.2+
- Tauri CLI

## Version Management

Before building a release, update version numbers in these files. All four must
match, and all four need updating: there is no single source across the Rust,
NPM, and Python halves of the project.

1. **desktop-app/src-tauri/tauri.conf.json**: bundle version (names the installer)
   ```json
   {
     "version": "2.4.1"
   }
   ```

2. **desktop-app/src-tauri/Cargo.toml**: crate version
   ```toml
   version = "2.4.1"
   ```
   This is the one the GUI displays. `get_app_version` returns
   `CARGO_PKG_VERSION`, which feeds the header and the About dialog, so a stale
   value here is visible to users even when everything else is correct.

3. **desktop-app/package.json**: NPM package version
   ```json
   {
     "version": "2.4.1"
   }
   ```

4. **imgstax/__init__.py**: Python package version
   ```python
   __version__ = "2.4.1"
   ```
   `setup.py` parses this file rather than holding its own copy, so it does not
   need a separate edit.

Verify with:

```bash
grep -h '"version"' desktop-app/src-tauri/tauri.conf.json desktop-app/package.json && grep '^version' desktop-app/src-tauri/Cargo.toml && grep __version__ imgstax/__init__.py
```

**Version format**: Follow [Semantic Versioning](https://semver.org/) (MAJOR.MINOR.PATCH)
- MAJOR: Breaking changes
- MINOR: New features (backward compatible)
- PATCH: Bug fixes

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
- **On Windows**: Creates both MSVC and GNU variants for cross-toolchain compatibility

### 2. Build the Desktop App

Once the binary is built, create the Tauri app:

```bash
cd desktop-app
npm install  # If not already done
npm run tauri build
```

This creates installers in `desktop-app/src-tauri/target/release/bundle/`. Which
ones you get is decided by `bundle.targets` in `tauri.conf.json`, currently
`["msi", "dmg"]`:

- **macOS**: `.dmg` in `dmg/`. Note the `.app` does not survive the build: it is an
  intermediate that the DMG step deletes once packaging finishes, leaving `macos/`
  empty. To keep it, build with `npm run tauri build -- --bundles app`.
- **Windows**: `.msi` in `msi/`. There is no NSIS `.exe` installer, because `nsis`
  is not in `bundle.targets`. Add it there, or build with
  `npm run tauri build -- --bundles nsis`, if you want one.
- **Linux**: nothing. Neither `msi` nor `dmg` applies to Linux, so the build
  produces the binary but no package. To get one, build with
  `npm run tauri build -- --bundles deb,appimage` (or add those to
  `bundle.targets`).

The unbundled executable is always written to
`desktop-app/src-tauri/target/release/` regardless of targets.

### 3. Testing the Build

Before distribution, test the built application:

**macOS**:
```bash
# Install from DMG (the .app is removed after packaging, so mount the DMG)
open desktop-app/src-tauri/target/release/bundle/dmg/imgstax_*.dmg

# Or run the unbundled binary directly
./desktop-app/src-tauri/target/release/imgstax-desktop
```

**Windows**:
```powershell
# Install the MSI
Start-Process desktop-app\src-tauri\target\release\bundle\msi\imgstax_*.msi

# Or run the unbundled binary directly. Note this is imgstax-desktop.exe:
# imgstax.exe in the same folder is the bundled Python sidecar, not the GUI.
.\desktop-app\src-tauri\target\release\imgstax-desktop.exe
```

**Linux** (these paths exist only if you built with `--bundles deb,appimage`):
```bash
# Install DEB package
sudo dpkg -i desktop-app/src-tauri/target/release/bundle/deb/imgstax_*.deb

# Or run AppImage
chmod +x desktop-app/src-tauri/target/release/bundle/appimage/imgstax_*.AppImage
./desktop-app/src-tauri/target/release/bundle/appimage/imgstax_*.AppImage

# Or run the unbundled binary directly
./desktop-app/src-tauri/target/release/imgstax-desktop
```

### 4. Distribution

You can distribute the generated installers directly. Users do not need to install Python.

**GitHub Releases** (recommended):
1. Create a version tag: `git tag -a v2.4.1 -m "Release v2.4.1"`
2. Push the tag: `git push origin v2.4.1`
3. Create a GitHub Release and upload:
   - macOS: `.dmg` file
   - Windows: `.msi` file
   - Linux: `.deb` and `.AppImage` files, if you built them with
     `--bundles deb,appimage` (they are not produced by a default build)

**Direct Distribution**:
- Users download and install the appropriate file for their platform
- No additional dependencies required
- Auto-updates can be configured via Tauri's updater (optional)

## Development vs. Production

**Development Mode** (`npm run tauri dev`):
- Uses Python from your system with automatic discovery:
  1. Checks `IMGSTAX_PYTHON_PATH` environment variable
  2. Checks common install locations (pyenv, Homebrew, system Python)
  3. Falls back to `which python3`
- Requires imgstax package installed: `pip install -e .`
- Hot reloading enabled for rapid development

**Production Build** (`npm run tauri build`):
- Uses bundled imgstax binary (self-contained executable)
- Requires running `python build_binary.py` first
- No Python installation needed by end users
- Larger file size (~40-80 MB) but fully portable

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup instructions.

## Cross-Platform Building

**Important**: Tauri requires building on the native platform for production builds. Cross-compilation is not officially supported.

To build for multiple platforms:
- **macOS builds**: Must be built on macOS (Intel or Apple Silicon)
- **Windows builds**: Must be built on Windows (x64 or ARM64)
- **Linux builds**: Must be built on Linux (x64 or ARM64)

### Architecture-Specific Builds

**macOS**:
- Apple Silicon (M1/M2/M3/M4): Produces `aarch64-apple-darwin` binaries
- Intel: Produces `x86_64-apple-darwin` binaries
- Universal binaries (both architectures) require additional configuration
- **Note**: Apple Silicon binaries can run on Intel Macs via Rosetta 2, but with performance overhead

**Windows**:
- x64 (most common): Produces both `x86_64-pc-windows-msvc` and `x86_64-pc-windows-gnu` binaries
- Both toolchain variants are created automatically for cross-toolchain compatibility
- ARM64 (Surface, Snapdragon): Requires ARM64 Rust target

**Linux**:
- x64: Produces `x86_64-unknown-linux-gnu` binaries
- ARM64 (Raspberry Pi, ARM servers): Requires ARM64 toolchain

**Important**: Builds automatically target the host architecture. If you build on Apple Silicon, you get an ARM64 binary. If you build on Intel, you get an x64 binary. To support both, you need separate builds or a universal binary (advanced).

### Multi-Platform Release Options

To create releases with builds for multiple platforms:

1. **Build on each platform**: Use physical machines or dual-boot
2. **Virtual machines**: Use Parallels, VMware, or VirtualBox to run other operating systems

## Platform-Specific Notes

### macOS
**Binary format**: `imgstax-{arch}-apple-darwin`
- Example: `imgstax-aarch64-apple-darwin` (M1/M2/M3/M4) or `imgstax-x86_64-apple-darwin` (Intel)

**Prerequisites**:
```bash
# Install Xcode Command Line Tools
xcode-select --install

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js (via Homebrew)
brew install node
```

**Building**:
```bash
python build_binary.py
cd desktop-app
npm install
npm run tauri build
```

**Output location**: `desktop-app/src-tauri/target/release/bundle/`
- `.dmg` installer in `dmg/`
- `macos/` is left empty: the `.app` is an intermediate the DMG step deletes.
  Build with `--bundles app` if you need the bundle itself.

**Code Signing** (for distribution):
```bash
# Sign the app
codesign --deep --force --verify --verbose --sign "Developer ID Application: Your Name" imgstax.app

# Create signed DMG
# Note: Use a proper signing certificate from Apple Developer account
```

### Windows
**Binary format**: `imgstax-{arch}-pc-windows-{msvc|gnu}.exe`
- The build script automatically creates both MSVC and GNU variants:
  - `imgstax-x86_64-pc-windows-msvc.exe`
  - `imgstax-x86_64-pc-windows-gnu.exe`
- This ensures compatibility regardless of which Rust toolchain is active

**Prerequisites**:
1. Install [Visual Studio 2022 Build Tools](https://visualstudio.microsoft.com/downloads/) with:
   - Desktop development with C++
   - Windows 10/11 SDK

2. Install Rust:
   ```powershell
   # Download and run rustup-init.exe from https://rustup.rs/
   ```

3. Install Node.js:
   ```powershell
   # Download installer from https://nodejs.org/
   ```

4. Install Python 3.8+:
   ```powershell
   # Download installer from https://www.python.org/
   ```

**Building**:

```powershell
# From any command prompt (PowerShell, CMD, or Terminal)
# Navigate to the project:
cd F:\REPOS\imgstax

# Build the Python binary (creates both MSVC and GNU variants)
python build_binary.py

# Build the desktop app
cd desktop-app
npm run tauri build
```

**Notes**:
- The `build_binary.py` script automatically creates both MSVC and GNU binary variants
- Either Rust toolchain (MSVC or GNU) will work for the Tauri build
- MSVC toolchain is recommended for best compatibility
- No special command prompt needed - regular PowerShell/CMD works fine

**Output location**: `desktop-app/src-tauri/target/release/bundle/`
- `.msi` installer in `msi/`

> **Note**: The MSI does not bundle the WebView2 runtime. WebView2 is pre-installed on all Windows 10 (May 2020 update or later) and Windows 11 systems via Microsoft Edge. If a user encounters a WebView2 error, see the Troubleshooting section below.

**Troubleshooting**:
- If you get `cd` not working: use `cd /d F:\path` to change drives
- Windows Defender may flag the build process - add an exclusion for your project directory
- If the build fails looking for a binary, ensure `build_binary.py` completed successfully

### Linux
**Binary format**: `imgstax-{arch}-unknown-linux-gnu`
- Example: `imgstax-x86_64-unknown-linux-gnu`

**Prerequisites** (Ubuntu/Debian):
```bash
# Install system dependencies
sudo apt update
sudo apt install -y \
    libwebkit2gtk-4.0-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev

# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Python
sudo apt install -y python3 python3-pip
```

**Building**:
```bash
python3 build_binary.py
cd desktop-app
npm install
npm run tauri build
```

**Output location**: a default build produces no Linux package, because
`bundle.targets` in `tauri.conf.json` is `["msi", "dmg"]`. Build with
`npm run tauri build -- --bundles deb,appimage` (or add the targets to the config)
to get, under `desktop-app/src-tauri/target/release/bundle/`:
- `.deb` package in `deb/`
- `.AppImage` in `appimage/`
- `.rpm` package in `rpm/` (add `rpm` to `--bundles` as well)

The unbundled binary is at `desktop-app/src-tauri/target/release/imgstax-desktop`
either way.

## Troubleshooting

### PyInstaller Issues

**Build fails with import errors**:
```bash
# Ensure all dependencies are installed
pip install -r requirements.txt
pip install -e .

# Verify imgstax can be imported
python -c "import imgstax; print(imgstax.__version__)"
```

**Module not found at runtime**:
- PyInstaller may miss hidden imports
- Add missing modules to `build_binary.py` in the `hiddenimports` list
- Check PyInstaller warnings during build

**Python version mismatch**:
- Use Python 3.8-3.11 (best compatibility)
- PyInstaller requires 64-bit Python
- Virtual environments recommended: `python -m venv venv`

### Tauri Build Issues

**"Sidecar binary not found" error**:
```bash
# The bundled imgstax binary is missing
python build_binary.py
ls -la desktop-app/src-tauri/binaries/  # Verify binary exists
```

**Rust compilation errors**:
```bash
# Update Rust toolchain
rustup update

# Clean build cache
cd desktop-app/src-tauri
cargo clean
```

**Frontend build errors**:
```bash
# Verify frontend exists
ls -la dist/  # Should contain index.html, styles.css, main.js

# If missing, copy from desktop-app/dist/
cp -r desktop-app/dist/* dist/
```

### Platform-Specific Issues

**macOS**: "App is damaged" warning
- macOS Gatekeeper blocks unsigned apps
- Right-click → Open to bypass for testing
- For distribution, sign with Apple Developer certificate

**Windows**: Defender flags the app
- False positive common with PyInstaller executables
- Submit to Microsoft for analysis if needed
- Users may need to add security exception

**Windows**: App fails to launch with a WebView2 error
- The app requires the Microsoft WebView2 Runtime (pre-installed on Windows 10 May 2020 update+ and Windows 11)
- If missing, download and install it from: https://developer.microsoft.com/en-us/microsoft-edge/webview2/
- Install the "Evergreen Standalone Installer" for the user's architecture (x64 for most machines)

**Linux**: Missing system libraries
```bash
# Install WebKit dependencies
sudo apt install libwebkit2gtk-4.0-37

# For older systems
sudo apt install libwebkit2gtk-4.0-dev
```

### Binary Sizes

**Typical sizes**:
- macOS DMG: ~50-90 MB
- Windows MSI: ~40-80 MB (WebView2 not bundled; relies on system installation)
- Linux AppImage: ~50-85 MB

These sizes are normal for standalone Python applications that bundle the runtime, NumPy, Pillow, and other dependencies.

### Development Mode Issues

**"Python not found" error**:
```bash
# Set explicit Python path
export IMGSTAX_PYTHON_PATH=/path/to/python3

# Or install imgstax in your Python environment
pip install -e .
```

**Import errors in dev mode**:
```bash
# Verify imgstax is installed
python -c "import imgstax; import numpy; import PIL"

# Reinstall with dependencies
pip install -e ".[progress]"
```

**Hot reload not working**:
- Tauri only reloads frontend changes
- Backend (Rust) changes require restart
- Python code changes require app restart

## Build Commands

For local builds on each platform:

**All platforms**:
```bash
# Step 1: Build Python binary
python build_binary.py

# Step 2: Build Tauri app
cd desktop-app && npm run tauri build
```

The bundled installers will be in `desktop-app/src-tauri/target/release/bundle/` with platform-specific subdirectories.
