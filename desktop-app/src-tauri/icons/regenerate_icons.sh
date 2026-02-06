#!/bin/bash
# regenerate_icons.sh - Regenerate all app icons from app_icon.png
# Usage: ./regenerate_icons.sh

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🎨 Regenerating app icons from app_icon.png..."
echo ""

# Check if source icon exists
if [ ! -f "app_icon.png" ]; then
    echo "❌ Error: app_icon.png not found in $SCRIPT_DIR"
    exit 1
fi

# Get source icon dimensions
DIMENSIONS=$(sips -g pixelWidth -g pixelHeight app_icon.png 2>/dev/null | grep -E "pixelWidth|pixelHeight" | awk '{print $2}' | tr '\n' 'x' | sed 's/x$//')
echo "📏 Source icon: $DIMENSIONS"
echo ""

# Clean up old iconset if it exists
if [ -d "icon.iconset" ]; then
    echo "🧹 Cleaning up old iconset..."
    rm -rf icon.iconset
fi

# Create fresh iconset directory
echo "📁 Creating iconset directory..."
mkdir icon.iconset

# Generate all macOS icon sizes
echo "🍎 Generating macOS icon sizes..."
sips -z 16 16 app_icon.png --out icon.iconset/icon_16x16.png > /dev/null
sips -z 32 32 app_icon.png --out icon.iconset/icon_16x16@2x.png > /dev/null
sips -z 32 32 app_icon.png --out icon.iconset/icon_32x32.png > /dev/null
sips -z 64 64 app_icon.png --out icon.iconset/icon_32x32@2x.png > /dev/null
sips -z 128 128 app_icon.png --out icon.iconset/icon_128x128.png > /dev/null
sips -z 256 256 app_icon.png --out icon.iconset/icon_128x128@2x.png > /dev/null
sips -z 256 256 app_icon.png --out icon.iconset/icon_256x256.png > /dev/null
sips -z 512 512 app_icon.png --out icon.iconset/icon_256x256@2x.png > /dev/null
sips -z 512 512 app_icon.png --out icon.iconset/icon_512x512.png > /dev/null
cp app_icon.png icon.iconset/icon_512x512@2x.png
echo "   ✓ Generated 10 sizes (16px to 1024px)"

# Build .icns file
echo "📦 Building icon.icns..."
iconutil -c icns icon.iconset -o icon.icns
ICNS_SIZE=$(ls -lh icon.icns | awk '{print $5}')
echo "   ✓ icon.icns ($ICNS_SIZE)"

# Generate standard PNG sizes for Tauri
echo "🖼️  Generating standard PNG sizes..."
sips -z 32 32 app_icon.png --out 32x32.png > /dev/null
sips -z 128 128 app_icon.png --out 128x128.png > /dev/null
sips -z 256 256 app_icon.png --out 128x128@2x.png > /dev/null
echo "   ✓ 32x32.png, 128x128.png, 128x128@2x.png"

# Generate Windows .ico file using Python
echo "🪟 Generating Windows icon.ico..."
python3 << 'PYTHON_EOF'
from PIL import Image

# Load the source icon
img = Image.open('app_icon.png')

# Generate sizes for Windows .ico (16, 32, 48, 256)
sizes = [(16, 16), (32, 32), (48, 48), (256, 256)]
images = []

for size in sizes:
    resized = img.resize(size, Image.Resampling.LANCZOS)
    images.append(resized)

# Save as .ico with multiple sizes embedded
images[0].save('icon.ico', format='ICO', sizes=sizes, append_images=images[1:])
PYTHON_EOF

if [ $? -eq 0 ]; then
    ICO_SIZE=$(ls -lh icon.ico | awk '{print $5}')
    echo "   ✓ icon.ico ($ICO_SIZE) - sizes: 16, 32, 48, 256"
else
    echo "   ⚠️  Warning: Failed to generate icon.ico (Python/PIL may not be installed)"
fi

# Clean up temporary iconset directory
echo "🧹 Cleaning up..."
rm -rf icon.iconset

echo ""
echo "✅ Icon regeneration complete!"
echo ""
echo "Generated files:"
ls -lh icon.icns icon.ico 32x32.png 128x128.png 128x128@2x.png 2>/dev/null | awk '{print "   " $9 " (" $5 ")"}'
echo ""
echo "💡 To refresh macOS icon cache, run:"
echo "   sudo rm -rf /Library/Caches/com.apple.iconservices.store && killall Dock"
