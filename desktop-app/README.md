# imgstax Desktop App

A native desktop application for imgstax image stacking tool, built with Tauri.

## Quick Start

### Prerequisites

1. **Node.js** (for frontend and Tauri CLI)
   ```bash
   # macOS
   brew install node

   # Windows: Download from https://nodejs.org/
   # Linux: apt install nodejs npm
   ```

2. **Rust** (for Tauri backend)
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

3. **Install dependencies** (one-time setup)
   ```bash
   cd desktop-app
   npm install
   ```

### Running the App

**Easiest (Cross-Platform):**
```bash
python utils/start-desktop.py
```

**Platform-Specific Shortcuts:**
```bash
# Unix/macOS
./utils/start-desktop.sh

# Windows
utils\start-desktop.bat
```

**Alternative (from desktop-app directory):**
```bash
cd desktop-app
npm run dev
```

## Features

- 🎯 **Native file picker** - Browse for directories with system dialog
- 🖼️ **File browser** - Preview images and right-click to set frame ranges
- 🖥️ **Desktop app** - No browser or web server needed
- 🎨 **Clean interface** - Same beautiful UI as web version
- 📊 **Batch processing** - Queue multiple jobs with progress tracking
- ⚙️ **All features** - Trail length, gradient, fade-out, quality control
- 🍎 **Native** - Distributable as .dmg (macOS), .exe (Windows), .AppImage (Linux)

## Development

### File Structure
```
desktop-app/
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   └── lib.rs          # Tauri commands (Rust ↔ Python bridge)
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # App configuration
├── package.json            # npm scripts
├── node_modules/           # npm dependencies
└── README.md

../dist/                    # Frontend (HTML/CSS/JS)
├── index.html
├── style.css
└── main.js
```

### Development Commands

```bash
# Run in development mode (hot reload enabled)
npm run dev

# Build for production
npm run build

# Build output locations:
# macOS:   src-tauri/target/release/bundle/dmg/imgstax_2.2.0_x64.dmg
# Windows: src-tauri/target/release/bundle/msi/imgstax_2.2.0_x64_en-US.msi
# Linux:   src-tauri/target/release/bundle/appimage/imgstax.AppImage
```

### How It Works

1. **Frontend (HTML/CSS/JS)** - User interface in `../dist/`
2. **Tauri (Rust)** - Desktop app framework in `src-tauri/`
3. **Commands** - Rust calls Python subprocess to run imgstax
4. **Native dialogs** - OS-native file/folder pickers

### Adding New Features

1. Add UI to `../dist/index.html` and `../dist/main.js`
2. Add Rust command to `src-tauri/src/lib.rs`
3. Register command in `invoke_handler![]` macro
4. Call from frontend using `invoke('command_name', { args })`

## Distribution

To create a standalone app for distribution:

```bash
npm run build
```

This creates:
- **macOS**: `.app` bundle and `.dmg` installer
- **Windows**: `.msi` installer (includes WebView2 runtime)
- **Linux**: `.AppImage` and `.deb` package

The built app includes everything needed - no Python or dependencies required for end users.

## Troubleshooting

### macOS: "imgstax.app is damaged and can't be opened"

This occurs when macOS Gatekeeper blocks unsigned applications. To fix:

1. Open Terminal
2. Type the following command (don't press Enter yet):
   ```bash
   sudo xattr -rd com.apple.quarantine
   ```
3. Drag the imgstax.app file from Finder into the Terminal window (this adds the path)
4. Press Enter
5. Enter your password when prompted (you won't see it as you type)
6. Try opening the app again

**Note:** Right-click → Open sometimes works but is not always reliable. The Terminal method above is the most dependable solution.

### Rust/Cargo not found
Ensure cargo is in your PATH:
```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

### First build is slow
The first build compiles all Rust dependencies (~5 minutes). Subsequent builds are much faster (~10 seconds).

### Dialog doesn't open
Check browser console (Right-click → Inspect → Console) for errors. The Tauri APIs must be properly initialized.

### Python errors
The app calls Python subprocess. Ensure:
- Python 3.8+ is installed
- imgstax dependencies are installed (`pip install -r requirements.txt`)
- Running from repository root

## Comparison: Desktop vs Web

| Feature | Desktop App | Web App |
|---------|-------------|---------|
| Installation | Requires build/install | Just run Python |
| File picker | Native OS dialog | Type path manually |
| Distribution | Standalone .app/.exe | Need Python installed |
| Updates | Rebuild required | Git pull |
| Performance | Native | Web view |
| Best for | End users | Developers |

## Next Steps

- [ ] Add real-time progress updates (event streaming)
- [ ] Bundle Python as Tauri sidecar (no Python dependency)
- [ ] Add recipe preview/thumbnails
- [ ] Implement drag-and-drop folder selection
- [ ] Add app icon and branding
- [ ] Set up auto-updater
- [ ] Create Windows/Linux builds
