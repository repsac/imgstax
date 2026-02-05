#!/bin/bash
#
# create_video.sh - Compile stacked images into a video using ffmpeg
# Usage: ./create_video.sh <input_directory> [output_file] [fps] [codec]
#
# Requirements: ffmpeg must be installed
#   macOS: brew install ffmpeg
#   Linux: apt-get install ffmpeg or yum install ffmpeg

set -e  # Exit on error

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DEFAULT_FPS=30
DEFAULT_CODEC="libx264"
DEFAULT_QUALITY="high"

# Function to print colored messages
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if ffmpeg is installed
check_ffmpeg() {
    if ! command -v ffmpeg &> /dev/null; then
        print_error "ffmpeg is not installed"
        echo ""
        echo "Installation instructions:"
        echo "  macOS:  brew install ffmpeg"
        echo "  Ubuntu: sudo apt-get install ffmpeg"
        echo "  CentOS: sudo yum install ffmpeg"
        echo ""
        exit 1
    fi
    print_info "ffmpeg found: $(ffmpeg -version | head -n 1)"
}

# Function to display usage
usage() {
    cat << EOF
Usage: $0 <input_directory> [options]

Compile stacked images from imgstax into a video file using ffmpeg.

Arguments:
    input_directory    Directory containing stacked images (required)

Options:
    -o, --output FILE      Output video file (default: output_<timestamp>.mp4)
    -f, --fps NUMBER       Frames per second (default: $DEFAULT_FPS)
    -c, --codec CODEC      Video codec (default: $DEFAULT_CODEC)
                          Options: libx264, libx265, libvpx-vp9, prores
    -q, --quality LEVEL    Quality preset (default: $DEFAULT_QUALITY)
                          Options: low, medium, high, lossless
    -p, --pattern GLOB     Image filename pattern (default: stacked-*.*)
    -s, --scale WIDTHxHEIGHT  Scale video (e.g., 1920x1080, -1:720)
    -h, --help             Show this help message

Examples:
    # Basic usage - create video from stacked images
    $0 output_directory

    # Custom output file and 60 fps
    $0 output_directory -o timelapse.mp4 -f 60

    # High quality H.265 video
    $0 output_directory -c libx265 -q high

    # Scale down to 720p
    $0 output_directory -s -1:720

    # WebM format with VP9 codec
    $0 output_directory -o video.webm -c libvpx-vp9

EOF
    exit 0
}

# Parse arguments
INPUT_DIR=""
OUTPUT_FILE=""
FPS=$DEFAULT_FPS
CODEC=$DEFAULT_CODEC
QUALITY=$DEFAULT_QUALITY
PATTERN="stacked-*.*"
SCALE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -o|--output)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        -f|--fps)
            FPS="$2"
            shift 2
            ;;
        -c|--codec)
            CODEC="$2"
            shift 2
            ;;
        -q|--quality)
            QUALITY="$2"
            shift 2
            ;;
        -p|--pattern)
            PATTERN="$2"
            shift 2
            ;;
        -s|--scale)
            SCALE="$2"
            shift 2
            ;;
        *)
            if [[ -z "$INPUT_DIR" ]]; then
                INPUT_DIR="$1"
            else
                print_error "Unknown argument: $1"
                usage
            fi
            shift
            ;;
    esac
done

# Validate input directory
if [[ -z "$INPUT_DIR" ]]; then
    print_error "Input directory is required"
    echo ""
    usage
fi

if [[ ! -d "$INPUT_DIR" ]]; then
    print_error "Input directory does not exist: $INPUT_DIR"
    exit 1
fi

# Check for ffmpeg
check_ffmpeg

# Find images (excluding metadata.json)
print_info "Searching for images in: $INPUT_DIR"
IMAGE_COUNT=$(find "$INPUT_DIR" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.tif" -o -iname "*.tiff" \) ! -name "metadata.json" | wc -l | tr -d ' ')

if [[ $IMAGE_COUNT -eq 0 ]]; then
    print_error "No images found in $INPUT_DIR"
    exit 1
fi

print_success "Found $IMAGE_COUNT images"

# Determine output file
if [[ -z "$OUTPUT_FILE" ]]; then
    TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
    OUTPUT_FILE="output_${TIMESTAMP}.mp4"
fi

# Get the output extension
OUTPUT_EXT="${OUTPUT_FILE##*.}"

# Set codec based on output extension if not specified
if [[ "$CODEC" == "$DEFAULT_CODEC" ]]; then
    case "$OUTPUT_EXT" in
        webm)
            CODEC="libvpx-vp9"
            print_info "Detected WebM format, using VP9 codec"
            ;;
        mov)
            CODEC="prores"
            print_info "Detected MOV format, using ProRes codec"
            ;;
    esac
fi

# Build ffmpeg command
FFMPEG_CMD="ffmpeg -y"

# Input pattern - find first image to determine pattern
FIRST_IMAGE=$(find "$INPUT_DIR" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" \) ! -name "metadata.json" | sort | head -n 1)

if [[ -z "$FIRST_IMAGE" ]]; then
    print_error "Could not find first image"
    exit 1
fi

# Determine input pattern for ffmpeg
BASENAME=$(basename "$FIRST_IMAGE")
if [[ $BASENAME =~ ^(.*?)([0-9]+)(\.[^.]+)$ ]]; then
    PREFIX="${BASH_REMATCH[1]}"
    NUMBER="${BASH_REMATCH[2]}"
    EXT="${BASH_REMATCH[3]}"
    NUM_DIGITS=${#NUMBER}

    # Create pattern like "stacked-%05d.jpg"
    INPUT_PATTERN="${INPUT_DIR}/${PREFIX}%0${NUM_DIGITS}d${EXT}"
    FFMPEG_CMD="$FFMPEG_CMD -framerate $FPS -i \"$INPUT_PATTERN\""
else
    print_error "Could not determine image numbering pattern"
    exit 1
fi

# Codec-specific settings
case "$CODEC" in
    libx264)
        case "$QUALITY" in
            low)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libx264 -preset fast -crf 28"
                ;;
            medium)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libx264 -preset medium -crf 23"
                ;;
            high)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libx264 -preset slow -crf 18"
                ;;
            lossless)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libx264 -preset veryslow -crf 0"
                ;;
        esac
        FFMPEG_CMD="$FFMPEG_CMD -pix_fmt yuv420p"
        ;;

    libx265)
        case "$QUALITY" in
            low)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libx265 -preset fast -crf 32"
                ;;
            medium)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libx265 -preset medium -crf 28"
                ;;
            high)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libx265 -preset slow -crf 22"
                ;;
            lossless)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libx265 -preset veryslow -x265-params lossless=1"
                ;;
        esac
        FFMPEG_CMD="$FFMPEG_CMD -pix_fmt yuv420p"
        ;;

    libvpx-vp9)
        case "$QUALITY" in
            low)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libvpx-vp9 -b:v 1M -crf 40"
                ;;
            medium)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libvpx-vp9 -b:v 2M -crf 31"
                ;;
            high)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libvpx-vp9 -b:v 4M -crf 22"
                ;;
            lossless)
                FFMPEG_CMD="$FFMPEG_CMD -c:v libvpx-vp9 -lossless 1"
                ;;
        esac
        ;;

    prores)
        FFMPEG_CMD="$FFMPEG_CMD -c:v prores_ks -profile:v 3"
        ;;

    *)
        FFMPEG_CMD="$FFMPEG_CMD -c:v $CODEC"
        ;;
esac

# Add scaling if specified
if [[ -n "$SCALE" ]]; then
    FFMPEG_CMD="$FFMPEG_CMD -vf scale=$SCALE"
fi

# Add output file
FFMPEG_CMD="$FFMPEG_CMD \"$OUTPUT_FILE\""

# Display settings
echo ""
print_info "=== Video Creation Settings ==="
echo "  Input directory: $INPUT_DIR"
echo "  Output file:     $OUTPUT_FILE"
echo "  Images found:    $IMAGE_COUNT"
echo "  Frame rate:      $FPS fps"
echo "  Codec:           $CODEC"
echo "  Quality:         $QUALITY"
[[ -n "$SCALE" ]] && echo "  Scale:           $SCALE"
echo ""

# Calculate video duration
DURATION=$(echo "scale=2; $IMAGE_COUNT / $FPS" | bc)
print_info "Estimated video duration: ${DURATION}s"
echo ""

# Ask for confirmation
read -p "Proceed with video creation? [Y/n] " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ -n $REPLY ]]; then
    print_warning "Cancelled by user"
    exit 0
fi

# Execute ffmpeg
print_info "Creating video..."
echo ""
eval $FFMPEG_CMD

# Check if successful
if [[ $? -eq 0 ]]; then
    echo ""
    print_success "Video created successfully: $OUTPUT_FILE"

    # Display file size
    if [[ -f "$OUTPUT_FILE" ]]; then
        FILE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
        print_info "File size: $FILE_SIZE"
    fi
else
    print_error "Video creation failed"
    exit 1
fi
