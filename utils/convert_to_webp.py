#!/usr/bin/env python3
"""
Convert PNG screenshots to WebP format for smaller file sizes.
Preserves transparency (alpha channel) from PNG images.

Usage:
    python utils/convert_to_webp.py [--quality QUALITY] [--lossless] [--remove-originals]

Options:
    --quality QUALITY       WebP quality (1-100, default: 80)
    --lossless              Use lossless compression (larger but perfect quality)
    --remove-originals      Delete original PNG files after conversion
"""

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("Error: Pillow is required. Install with: pip install Pillow")
    sys.exit(1)


def convert_png_to_webp(png_path: Path, quality: int = 80, lossless: bool = False) -> Path:
    """Convert a single PNG file to WebP."""
    webp_path = png_path.with_suffix('.webp')

    print(f"Converting {png_path.name}...", end=" ")

    try:
        with Image.open(png_path) as img:
            # WebP supports transparency! Keep the alpha channel
            # No conversion needed - just save directly

            if lossless:
                # Lossless mode preserves everything perfectly
                img.save(webp_path, 'webp', lossless=True, method=6)
            else:
                # Lossy mode with transparency support (modern WebP)
                img.save(webp_path, 'webp', quality=quality, method=6)

        # Get file sizes for comparison
        original_size = png_path.stat().st_size
        new_size = webp_path.stat().st_size
        reduction = (1 - new_size / original_size) * 100

        print(f"✓ ({original_size:,} → {new_size:,} bytes, {reduction:.1f}% smaller)")
        return webp_path

    except Exception as e:
        print(f"✗ Error: {e}")
        return None


def main():
    parser = argparse.ArgumentParser(
        description='Convert PNG screenshots to WebP format (preserves transparency)'
    )
    parser.add_argument(
        '--quality',
        type=int,
        default=80,
        help='WebP quality (1-100, default: 80, ignored if --lossless)'
    )
    parser.add_argument(
        '--lossless',
        action='store_true',
        help='Use lossless compression (larger files, perfect quality)'
    )
    parser.add_argument(
        '--remove-originals',
        action='store_true',
        help='Delete original PNG files after conversion'
    )

    args = parser.parse_args()

    # Validate quality
    if not 1 <= args.quality <= 100:
        print("Error: Quality must be between 1 and 100")
        sys.exit(1)

    # Find screenshots directory
    screenshots_dir = Path(__file__).parent.parent / 'docs' / 'screenshots'

    if not screenshots_dir.exists():
        print(f"Creating screenshots directory: {screenshots_dir}")
        screenshots_dir.mkdir(parents=True, exist_ok=True)

    # Find all PNG files
    png_files = list(screenshots_dir.glob('*.png'))

    if not png_files:
        print(f"No PNG files found in {screenshots_dir}")
        print("\nPlace your screenshots in docs/screenshots/ and run again.")
        sys.exit(0)

    print(f"Found {len(png_files)} PNG file(s) in {screenshots_dir}\n")
    if args.lossless:
        print(f"Converting with lossless compression (transparency preserved)...\n")
    else:
        print(f"Converting with quality={args.quality} (transparency preserved)...\n")

    # Convert all PNGs
    converted = []
    for png_file in sorted(png_files):
        webp_file = convert_png_to_webp(png_file, quality=args.quality, lossless=args.lossless)
        if webp_file:
            converted.append((png_file, webp_file))

    # Summary
    print(f"\n{'='*60}")
    print(f"Converted {len(converted)} of {len(png_files)} file(s)")

    if converted:
        total_original = sum(png.stat().st_size for png, _ in converted)
        total_new = sum(webp.stat().st_size for _, webp in converted)
        total_reduction = (1 - total_new / total_original) * 100

        print(f"Total size: {total_original:,} → {total_new:,} bytes")
        print(f"Total reduction: {total_reduction:.1f}%")

        # Remove originals if requested
        if args.remove_originals:
            print(f"\nRemoving original PNG files...")
            for png_file, _ in converted:
                png_file.unlink()
                print(f"  Removed {png_file.name}")
            print("\nOriginal PNG files deleted.")
        else:
            print("\nOriginal PNG files kept (use --remove-originals to delete)")

    print(f"{'='*60}")


if __name__ == '__main__':
    main()
