@echo off
REM start-desktop.bat - Windows launcher for imgstax desktop app

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0
cd /d "%SCRIPT_DIR%"

REM Find Python executable
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PYTHON=python
    goto :run
)

where python3 >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PYTHON=python3
    goto :run
)

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    set PYTHON=py
    goto :run
)

echo Error: Python not found in PATH
echo Please install Python 3.8 or later
exit /b 1

:run
REM Run the Python launcher
"%PYTHON%" start-desktop.py %*
