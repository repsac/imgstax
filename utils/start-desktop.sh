#!/bin/bash
# start-desktop.sh - Unix/macOS launcher for imgstax desktop app

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Find Python executable
if command -v python3 &> /dev/null; then
    PYTHON=python3
elif command -v python &> /dev/null; then
    PYTHON=python
else
    echo "Error: Python not found in PATH"
    echo "Please install Python 3.8 or later"
    exit 1
fi

# Run the Python launcher
exec "$PYTHON" start-desktop.py "$@"
