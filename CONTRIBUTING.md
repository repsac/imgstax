# Contributing to imgstax

Thank you for your interest in contributing to imgstax!

## Development Setup

### Prerequisites

1. **Python 3.8+** with imgstax installed
2. **Node.js and npm** (for desktop app)
3. **Rust and Cargo** (for desktop app)

### Python Setup

The desktop app requires Python 3 with the imgstax package installed for development.

#### Option 1: Automatic (Recommended)

If `python3` is in your PATH, the app will find it automatically:

```bash
which python3  # Should return a valid path
pip install -e .  # Install imgstax in development mode
```

#### Option 2: Explicit Path

Set the `IMGSTAX_PYTHON_PATH` environment variable:

```bash
export IMGSTAX_PYTHON_PATH=/path/to/your/python3
pip install -e .
```

You can add this to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) to make it persistent.

### Desktop App Development

```bash
cd desktop-app
npm install
npm run tauri dev
```

The app will automatically:
1. Check for `IMGSTAX_PYTHON_PATH` environment variable
2. Check common install locations (in priority order):
   - `~/.pyenv/shims/python3` (pyenv-managed Python)
   - `/opt/homebrew/bin/python3` (Homebrew Python)
   - `/usr/local/bin/python3` (locally-installed Python)
   - `/usr/bin/python3` (system Python)
3. Look for `python3` in your PATH as last resort

If Python can't be found, you'll see a helpful error message with solutions.

**Note:** Explicit path checking happens before PATH lookup because subprocess environments may not have the same PATH as your shell, and user-installed Python (pyenv, Homebrew) is more likely to have imgstax and its dependencies installed.

### Production Build

Production builds bundle the imgstax binary, so Python is not needed:

```bash
cd desktop-app
npm run tauri build
```

## Common Issues

### "Python 3 interpreter not found"

**Solution 1:** Ensure `python3` is in your PATH
```bash
which python3  # Should return a path
```

**Solution 2:** Set the environment variable
```bash
export IMGSTAX_PYTHON_PATH=/usr/local/bin/python3
```

**Solution 3:** Install Python
- macOS: `brew install python3`
- Linux: `apt install python3` or equivalent

### Import errors (numpy, PIL, etc.)

Make sure imgstax is installed with dependencies:
```bash
pip install -e ".[progress]"
```

## Testing

```bash
# Run Python tests
pytest

# Test desktop app
cd desktop-app
npm run tauri dev
```

## Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Test thoroughly
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Code Style

- **Python:** Follow PEP 8
- **JavaScript:** Use existing code style (ES6+)
- **Rust:** Follow `rustfmt` conventions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
