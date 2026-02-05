@echo off
REM create_video.bat - Compile stacked images into a video using ffmpeg (Windows)
REM Usage: create_video.bat <input_directory> [output_file] [fps] [quality]
REM
REM Requirements: ffmpeg must be installed and in PATH
REM   Download from: https://ffmpeg.org/download.html

setlocal enabledelayedexpansion

REM Default values
set DEFAULT_FPS=30
set DEFAULT_QUALITY=high
set DEFAULT_CODEC=libx264

REM Parse arguments
set INPUT_DIR=%~1
set OUTPUT_FILE=%~2
set FPS=%~3
set QUALITY=%~4

REM Show help if no arguments
if "%INPUT_DIR%"=="" (
    call :show_help
    exit /b 1
)

if "%INPUT_DIR%"=="-h" (
    call :show_help
    exit /b 0
)

if "%INPUT_DIR%"=="--help" (
    call :show_help
    exit /b 0
)

REM Set defaults
if "%OUTPUT_FILE%"=="" (
    for /f "tokens=1-6 delims=/:. " %%a in ("%date% %time%") do (
        set OUTPUT_FILE=output_%%c%%a%%b_%%d%%e%%f.mp4
    )
)

if "%FPS%"=="" set FPS=%DEFAULT_FPS%
if "%QUALITY%"=="" set QUALITY=%DEFAULT_QUALITY%

REM Check if input directory exists
if not exist "%INPUT_DIR%" (
    echo [ERROR] Input directory does not exist: %INPUT_DIR%
    exit /b 1
)

REM Check if ffmpeg is installed
where ffmpeg >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] ffmpeg is not installed or not in PATH
    echo.
    echo Download ffmpeg from: https://ffmpeg.org/download.html
    echo After installing, add ffmpeg to your PATH environment variable
    echo.
    exit /b 1
)

echo [INFO] ffmpeg found
ffmpeg -version | findstr "ffmpeg version"

REM Count images
echo [INFO] Searching for images in: %INPUT_DIR%
set IMAGE_COUNT=0
for %%f in ("%INPUT_DIR%\*.jpg" "%INPUT_DIR%\*.jpeg" "%INPUT_DIR%\*.png") do (
    if not "%%~nxf"=="metadata.json" (
        set /a IMAGE_COUNT+=1
    )
)

if %IMAGE_COUNT% EQU 0 (
    echo [ERROR] No images found in %INPUT_DIR%
    exit /b 1
)

echo [SUCCESS] Found %IMAGE_COUNT% images

REM Find first image to determine pattern
set FIRST_IMAGE=
for /f "delims=" %%f in ('dir /b /o:n "%INPUT_DIR%\stacked-*.jpg" "%INPUT_DIR%\stacked-*.jpeg" "%INPUT_DIR%\stacked-*.png" 2^>nul') do (
    if not defined FIRST_IMAGE set FIRST_IMAGE=%%f
)

if "%FIRST_IMAGE%"=="" (
    echo [ERROR] Could not find stacked images
    exit /b 1
)

REM Extract pattern (assuming format like stacked-00001.jpg)
set INPUT_PATTERN=%INPUT_DIR%\stacked-%%05d.jpg

REM Check if first image is PNG
echo %FIRST_IMAGE% | findstr /i ".png" >nul
if %ERRORLEVEL% EQU 0 (
    set INPUT_PATTERN=%INPUT_DIR%\stacked-%%05d.png
)

REM Set codec parameters based on quality
if "%QUALITY%"=="low" (
    set CODEC_PARAMS=-c:v libx264 -preset fast -crf 28 -pix_fmt yuv420p
) else if "%QUALITY%"=="medium" (
    set CODEC_PARAMS=-c:v libx264 -preset medium -crf 23 -pix_fmt yuv420p
) else if "%QUALITY%"=="high" (
    set CODEC_PARAMS=-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p
) else if "%QUALITY%"=="lossless" (
    set CODEC_PARAMS=-c:v libx264 -preset veryslow -crf 0 -pix_fmt yuv420p
) else (
    set CODEC_PARAMS=-c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p
)

REM Display settings
echo.
echo === Video Creation Settings ===
echo   Input directory: %INPUT_DIR%
echo   Output file:     %OUTPUT_FILE%
echo   Images found:    %IMAGE_COUNT%
echo   Frame rate:      %FPS% fps
echo   Quality:         %QUALITY%
echo   Input pattern:   %INPUT_PATTERN%
echo.

REM Ask for confirmation
set /p CONFIRM="Proceed with video creation? [Y/n] "
if /i not "%CONFIRM%"=="Y" if not "%CONFIRM%"=="" (
    echo [WARNING] Cancelled by user
    exit /b 0
)

REM Create video
echo [INFO] Creating video...
echo.

ffmpeg -y -framerate %FPS% -i "%INPUT_PATTERN%" %CODEC_PARAMS% "%OUTPUT_FILE%"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Video created successfully: %OUTPUT_FILE%

    REM Display file size
    if exist "%OUTPUT_FILE%" (
        for %%A in ("%OUTPUT_FILE%") do (
            set SIZE=%%~zA
            set /a SIZE_MB=!SIZE! / 1048576
            echo [INFO] File size: !SIZE_MB! MB
        )
    )
) else (
    echo [ERROR] Video creation failed
    exit /b 1
)

goto :eof

:show_help
echo.
echo create_video.bat - Compile stacked images into a video using ffmpeg
echo.
echo Usage: create_video.bat ^<input_directory^> [output_file] [fps] [quality]
echo.
echo Arguments:
echo   input_directory    Directory containing stacked images (required)
echo   output_file        Output video filename (default: output_^<timestamp^>.mp4)
echo   fps                Frames per second (default: 30)
echo   quality            Quality preset (default: high)
echo                      Options: low, medium, high, lossless
echo.
echo Examples:
echo   create_video.bat output_directory
echo   create_video.bat output_directory timelapse.mp4 60 high
echo   create_video.bat output_directory video.mp4 30 lossless
echo.
echo Requirements:
echo   - ffmpeg must be installed and in PATH
echo   - Download from: https://ffmpeg.org/download.html
echo.
goto :eof
