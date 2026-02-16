#!/usr/bin/env python3
"""
Launcher script for imgstax PyInstaller binary.
This wrapper avoids relative import issues by using absolute imports.
"""

if __name__ == '__main__':
    from imgstax.cli import main
    main()
