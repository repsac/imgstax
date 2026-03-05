# imgstax CLI - Command-Line Image Sequence Stacking

A specialized command-line tool for creating **animated progressions** from image sequences using various stacking algorithms. imgstax processes sequential frames (from timelapse or video) to generate frame-by-frame stacked outputs, perfect for star trail animations, time-lapse effects, and visualizing motion over time.

> **Looking for the GUI?** Check out the [Desktop Application README](README.md) for the graphical interface with visual file browser, recipe editor, and batch processing queue.

**What imgstax does:** Progressive stacking of sequential frames to create animations
**What imgstax doesn't do:** Complex single-image stacking with calibration frames (use [StarStax](https://markus-enzweiler.de/software/starstax/), Photoshop, or Affinity Photo instead)

## Features

### Core Functionality
- **Progressive Sequential Stacking**: Creates animated sequences where each output frame is a stack of previous input frames
- **Multiple Stacking Algorithms**: maximum, minimum, mean, median, standard deviation, summation, variance, and range
- **Sliding Window Effects**: Limit trail length for moving window stacking (e.g., last 20 frames only)
- **Trail Gradient**: Comet tail effect with progressive fade along the trail
- **Fade Out**: Gradually fade trails at the end of sequences
- **Frame Selection**: Start, stop, and step parameters for selective processing from your sequence
- **Dry Run Mode**: Test operations without creating output files

### Enhanced Features (v2.0+)
- **Type Hints**: Full type annotations for better IDE support
- **pathlib Support**: Modern Path-based file handling
- **Progress Bars**: Optional tqdm integration for visual progress (install with `pip install tqdm`)
- **Image Validation**: Automatic dimension validation prevents runtime errors
- **Quality Control**: Adjustable JPEG quality, PNG compression level, and TIFF compression formats
- **Better Error Messages**: Comprehensive error reporting
- **Modular Architecture**: Clean, maintainable codebase
- **Configuration Validation**: Early detection of invalid parameters
- **Recipe System**: YAML-based presets for common use cases (v2.1)
- **Trail Gradient**: Weighted blending for comet tail effects (v2.1)
- **Auto-prefix Exports**: Prevents accidental git commits of exports (v2.1)

## Installation

### From Source
```bash
git clone https://github.com/repsac/imgstax.git
cd imgstax
pip install -e .
```

### Dependencies
```bash
pip install -r requirements.txt
```

Required:
- Python >= 3.8
- numpy >= 1.20.0
- Pillow >= 8.0.0
- PyYAML >= 5.4.0 (for recipe system)

Optional:
- tqdm >= 4.60.0 (for progress bars)

## Usage

### Command-Line Interface

```bash
# Stack all images in a directory using maximum intensity
python imgstax.py /path/to/images

# Or using the module
python -m imgstax /path/to/images

# Or using the installed command
imgstax /path/to/images
```

### Common Examples

**Star Trail Photography (Maximum Stacking)**
```bash
imgstax /path/to/astro/images -o star_trails -s maximum
```

**Noise Reduction (Mean Stacking)**
```bash
imgstax /path/to/images -o clean_output -s mean
```

**Limited Trail Length (Comet Effect)**
```bash
imgstax /path/to/images -o comet_trails -t 10 -s maximum
```

**Fade Out Effect**
```bash
imgstax /path/to/images -o fading_trails -t 20 -f -s maximum
```

**Process Every Nth Frame**
```bash
imgstax /path/to/images --step 5 -o timelapse_stack
```

**Frame Range Selection**
```bash
imgstax /path/to/images --start 100 --stop 500 -o selected_range
```

**High-Quality JPEG Output**
```bash
imgstax /path/to/images -q 98 -o high_quality
```

**Comet Tail Effect (Trail Gradient)**
```bash
imgstax /path/to/images -t 20 -g -o comet_effect
```

**Bird Murmurations**
```bash
imgstax /path/to/bird_images -s minimum -t 15 -g -o murmurations
```

## Recipes & Presets

Recipes are pre-configured settings for common use cases. No need to memorize CLI arguments!

### Using Built-in Recipes

```bash
# Star trail photography
python -m imgstax images/ --recipe stars

# Bird murmurations
python -m imgstax images/ --recipe murmurations

# Traffic light trails
python -m imgstax images/ --recipe traffic

# Time-lapse effects
python -m imgstax images/ --recipe timelapse

# List all available recipes
python -m imgstax --list-recipes
```

### Built-in Recipes

| Recipe | Stacking | Trail | Gradient | Best For |
|--------|----------|-------|----------|----------|
| **stars** | maximum | 30 | Yes | Star trails, astrophotography |
| **murmurations** | minimum | 15 | Yes | Bird flocks, dark objects in motion |
| **traffic** | maximum | 20 | Yes | Vehicle light trails |
| **timelapse** | mean | 5 | No | Time-lapse with motion blur |
| **fireworks** | maximum | 10 | No | Firework composites |
| **noise-reduction** | mean | 0 | No | Noise reduction averaging |

### Overriding Recipe Settings

CLI arguments override recipe defaults:

```bash
# Use stars recipe but with longer trails
python -m imgstax images/ --recipe stars --trail-length 50

# Use traffic recipe with different quality
python -m imgstax images/ --recipe traffic -q 100
```

### Creating Custom Recipes

#### Using the Desktop GUI Recipe Editor

The Desktop GUI includes a built-in Recipe Editor for creating and managing custom recipes:

1. Select "✎ Recipe Editor" from the recipe dropdown
2. Fill in the recipe details (name, description, settings)
3. Click "Save Recipe" to create your custom recipe
4. User recipes appear in the dropdown with a "(User)" suffix

User recipes are stored in OS-appropriate locations:
- **macOS**: `~/Library/Application Support/imgstax-desktop/user_recipes/`
- **Linux**: `~/.config/imgstax-desktop/user_recipes/`
- **Windows**: `%APPDATA%/imgstax-desktop/user_recipes/`

#### Creating Recipes Manually (CLI)

For CLI usage, create YAML files in `~/.imgstax/recipes/`:

```yaml
name: "My Custom Recipe"
description: "Custom settings for my workflow"

settings:
  stacking: maximum
  trail_length: 25
  fade_out: true
  quality: 92
```

Then use with:
```bash
python -m imgstax images/ --recipe my-custom
```

See [imgstax/recipes/README.md](imgstax/recipes/README.md) for complete recipe documentation.

## Command-Line Options

```
positional arguments:
  input                 Input directory containing the image sequences

options:
  -h, --help            Show this help message and exit
  -o, --output OUTPUT   Destination directory for generated images (default: timestamp)
  --recipe RECIPE       Load settings from recipe/preset (e.g., 'stars', 'traffic')
  --list-recipes        List all available recipes and exit
  --dryrun              Testing only, does not create any files or folders
  -p, --prefix PREFIX   File name prefix for stacked images (default: "stacked-")
  -s, --stacking FUNC   Stacking function: maximum, minimum, mean, median, etc. (default: maximum)
  -l, --logfile         Store all log output to file
  --start N             Start frame index
  --stop N              Stop frame index
  --step N              Process every Nth frame
  -t, --trail-length N  Limit the length of the trails
  -f, --fade-out        Fade out the trails (requires trail-length)
  -g, --trail-gradient  Apply gradient weighting for comet tail effect (requires trail-length)
  -q, --quality N       JPEG quality 1-100 (default: 100)
  --png-compress-level N    PNG compression level 0-9 (default: 6)
                            0=no compression, 9=maximum compression
  --tiff-compression TYPE   TIFF compression method (default: deflate)
                            Choices: none, lzw, deflate, jpeg
```

## Stacking Functions

- `maximum` / `max`: Maximum intensity (best for star trails, light trails)
- `mean`: Average intensity (best for noise reduction)
- `median`: Median intensity (removes transient objects)
- `minimum` / `min`: Minimum intensity (dark regions)
- `standard-deviation`: Standard deviation (motion detection)
- `summation`: Sum of all values (accumulation effects)
- `variance`: Variance (statistical analysis)
- `range`: Range between max and min (contrast analysis)

## Advanced Features

### Trail Gradient (Comet Tail Effect)

The `--trail-gradient` option creates a comet tail effect where the trail progressively fades along its length, with the newest frame at full intensity and older frames gradually decreasing.

**How it works:**
- Uses exponential decay weighting (default 0.85 decay factor)
- Newest frame: 100% intensity
- Older frames: progressively reduced intensity
- Creates smooth, natural-looking motion trails

**Best used with:**
- Star trails for smooth gradient effect
- Traffic light trails for realistic tails
- Any motion where you want progressive fade

**Example:**
```bash
# Stars with smooth gradient trails
imgstax star_images/ -t 30 -g --recipe stars

# Traffic with comet tail effect
imgstax traffic_images/ -t 20 -g -s maximum
```

**Note:** Requires `--trail-length` to be set (> 0).

---

### Gradient and Subject Contrast: Choosing the Right Stacking Mode

The visible length of a gradient trail depends on the **contrast between your subject and its background**. This is the most important factor when tuning the gradient effect.

#### Bright subjects on dark backgrounds (e.g. star trails, fireworks)

Use **maximum stacking**. Old bright pixels (e.g. stars at ~250) are weighted down but remain brighter than the dark background (~10–20), so the trail stays visible for many frames.

```bash
imgstax stars/ -t 30 -g -s maximum --gradient-decay 0.85
```

#### Dark subjects on bright backgrounds (e.g. bird murmurations, aircraft)

Use **minimum stacking**. With maximum stacking, dark subject pixels (~50–80) get weighted below the bright sky (~180–220) almost immediately — the trail is invisible after 1–2 frames. Minimum stacking fades old pixels toward white, keeping them darker than the sky background so the trail shows as a dark smear.

```bash
imgstax birds/ -t 30 -g -s minimum --gradient-decay 0.95
```

> **Why maximum stacking fails for dark subjects:** With `decay=0.85`, a dark bird pixel (~60) after just one frame of decay becomes `60 × 0.85 = 51`. The sky in the new frame is ~200. `max(200, 51) = 200` — the trail is immediately erased by the background.

#### Choosing a decay factor

The default decay of `0.85` works well for star trails but fades quickly for subjects with lower contrast against their background. Use a higher value for longer trails:

| Decay Factor | Approximate Visible Trail |
|---|---|
| 0.85 (default) | ~8 frames |
| 0.92 | ~17 frames |
| 0.95 | ~25 frames |
| 0.97 | ~40 frames |

These estimates assume a subject/background contrast ratio typical of dark birds on sky (~60 vs ~200). Star trails on dark sky will show significantly longer trails at the same decay value.

```bash
# Bird murmurations — minimum stacking, higher decay for longer trail
imgstax birds/ -t 35 -g -s minimum --gradient-decay 0.95

# Fine-tune the plateau (frames at full intensity before decay begins)
imgstax birds/ -t 35 -g -s minimum --gradient-decay 0.95 --gradient-plateau 3
```

## Supported Image Formats

- **JPEG** (.jpg, .jpeg, .jpe, .jfif)
- **PNG** (.png)
- **TIFF** (.tif, .tiff)
- **BMP** (.bmp, .dib)
- **WebP** (.webp)
- **TGA** (.tga)
- **Netpbm** (.ppm, .pgm, .pbm)

All images in a sequence must have the same dimensions.

## Format-Specific Options

### JPEG Quality
Control JPEG output quality with `-q` or `--quality`:
```bash
imgstax images/ -q 95 -o high_quality_output
```

### PNG Compression
Adjust PNG compression level with `--png-compress-level`:
```bash
# Maximum compression (slower, smaller files)
imgstax images/ --png-compress-level 9 -o compressed_output

# No compression (faster processing)
imgstax images/ --png-compress-level 0 -o fast_output
```

Default is 6 (good balance). Range: 0-9.

### TIFF Compression
Choose TIFF compression method with `--tiff-compression`:
```bash
# Deflate compression (default, good balance)
imgstax images/ --tiff-compression deflate -o output

# LZW compression (universal compatibility)
imgstax images/ --tiff-compression lzw -o output

# JPEG compression (lossy, smaller files)
imgstax images/ --tiff-compression jpeg -q 85 -o output

# No compression (fastest, largest files)
imgstax images/ --tiff-compression none -o output
```

Note: TIFF JPEG compression also uses the `--quality` parameter.

## Programmatic Usage

```python
from pathlib import Path
from imgstax import StackConfig, stack
import numpy

# Basic configuration
config = StackConfig(
    input_path=Path('/path/to/images'),
    output_path=Path('/path/to/output'),
    stacking_func=numpy.amax,
    stacking_name='maximum',
    trail_length=15,
    fade_out=True,
    quality=95
)

# Run stacking
stack(config)

# Advanced: Bird murmurations with gradient
config = StackConfig(
    input_path=Path('/path/to/bird_images'),
    output_path=Path('/path/to/output'),
    stacking_func=numpy.amin,  # minimum for dark objects
    stacking_name='minimum',
    trail_length=15,
    trail_gradient=True,  # Comet tail effect
    fade_out=True,
    quality=90
)

stack(config)
```

## Output

The tool generates:
1. **Stacked Images**: Progressive sequence of stacked images
2. **metadata.json**: Configuration and parameters used
3. **output.log**: Optional detailed log file (use `-l` flag)

## Creating Videos from Stacked Images

After generating stacked images, you can compile them into a video using the utilities in the `utils/` directory.

**Quick Start**:
```bash
# Using Python (cross-platform)
python utils/create_video.py output_directory

# Using bash (macOS/Linux)
./utils/create_video.sh output_directory

# Using PowerShell (Windows)
.\utils\create_video.ps1 -InputDirectory output_directory
```

**Advanced Examples**:
```bash
# 60 fps high-quality video
python utils/create_video.py output_dir -o timelapse.mp4 -f 60 -q high

# H.265 with 720p scaling for smaller file size
python utils/create_video.py output_dir -c libx265 -s -1:720

# WebM format for web use
python utils/create_video.py output_dir -o video.webm -c libvpx-vp9
```

See [utils/README.md](utils/README.md) for complete documentation on video creation options, codecs, and workflows.

## Project Structure

```
imgstax/
├── imgstax/                 # Main package
│   ├── __init__.py          # Package initialization
│   ├── __main__.py          # Module entry point
│   ├── cli.py               # Command-line interface
│   ├── config.py            # Configuration dataclass
│   ├── core.py              # Main stacking logic
│   ├── image_utils.py       # Image processing utilities
│   ├── file_utils.py        # File I/O operations
│   ├── recipe_loader.py     # Recipe/preset system
│   └── recipes/             # Built-in recipe presets
│       ├── README.md        # Recipe documentation
│       ├── stars.yaml       # Star trails recipe
│       ├── murmurations.yaml # Bird murmurations recipe
│       ├── traffic.yaml     # Traffic light trails recipe
│       ├── timelapse.yaml   # Time-lapse recipe
│       ├── fireworks.yaml   # Fireworks recipe
│       └── noise-reduction.yaml # Noise reduction recipe
├── utils/                   # Video creation utilities
│   ├── create_video.py      # Cross-platform Python script
│   ├── create_video.sh      # Bash script (macOS/Linux)
│   ├── create_video.bat     # Batch script (Windows)
│   ├── create_video.ps1     # PowerShell script (Windows)
│   └── README.md            # Video utilities documentation
├── imgstax.py               # Backwards-compatible entry point
├── setup.py                 # Package installation
├── requirements.txt         # Dependencies
└── README.md                # This file
```

## Use Cases

### When to Use imgstax

**Perfect for:**
- **Star Trail Animations**: Progressive stacking to create animated star trail sequences
- **Time-Lapse Effects**: Stacking sequential frames to show motion accumulation over time
- **Traffic Light Trails**: Animated progression of vehicle light trails
- **Motion Visualization**: Creating frame-by-frame visualizations of movement
- **Long Exposure Simulation**: Building up exposure across sequential frames
- **Creative Sequential Art**: Artistic effects from time-based image sequences

**Requires:**
- Sequential image frames (from timelapse camera or video extraction)
- Frames taken in order over time
- Goal is to create an animated progression or sequence

### When to Use Other Tools

**For complex astrophotography stacking with calibration frames** (dark frames, flat frames, bias frames), use specialized tools:
- **[StarStax](https://markus-enzweiler.de/software/starstax/)**: Excellent free tool for star trail stacking
- **Adobe Photoshop or Affinity Photo**: Advanced layering and calibration
- **DeepSkyStacker**: Specialized for deep sky astrophotography with calibration frames
- **PixInsight**: Professional-grade astronomical image processing

imgstax focuses on **progressive sequential stacking for animations**, not single-image perfection with calibration workflows.

## Performance Tips

1. **Image Size**: Smaller images process faster
2. **Trail Length**: Shorter trails require less memory
3. **Step Parameter**: Skip frames to speed up processing
4. **Dry Run**: Test with `--dryrun` first

## Troubleshooting

**"Image dimension mismatch" error**
- All images must have the same dimensions
- Check for different aspect ratios or resolutions

**Memory errors with large image sets**
- Use smaller trail length (`-t`)
- Process in batches with `--start` and `--stop`
- Use step parameter to skip frames

**No images found**
- Ensure images have supported extensions
- Check file permissions
- Look for hidden files (starting with `.`)

## Version History

### v2.3.0 (Current)
- **Post-Processing System**: Run shell commands (ffmpeg, etc.) after stacking completes
- **Expanded Image Format Support**: Added WebP, TGA, BMP, Netpbm support
- **Gradient Documentation**: Detailed guide on stacking mode selection for subject contrast

### v2.1.0
- **Recipe System**: YAML-based presets for common use cases
- **Trail Gradient**: Comet tail effect with exponential decay weighting
- **Auto-prefix Exports**: Prevents accidental git commits with 'export_' prefix
- **Enhanced Recipes**: Built-in presets for stars, murmurations, traffic, timelapse, fireworks, noise reduction
- **Video Creation**: Cross-platform utilities for compiling stacked images into videos
- **Improved Fade-Out**: Dynamic trail reduction in final frames

### v2.0.0
- Complete modular refactor
- Added type hints throughout
- Migrated to pathlib
- Added progress bars (tqdm)
- Improved error messages
- Added quality control
- Added image dimension validation
- Configuration dataclass

### v1.0.0
- Initial release
- Basic stacking functionality

## License

MIT License - see file header for full text

## Contributing

Contributions welcome! Areas for future development:
- Direct video input/output support (currently requires pre-extraction)
- Parallel processing for speed improvements
- Resume capability for interrupted processes
- Additional stacking algorithms
- Real-time preview mode
- Automatic optimal parameter detection

**Out of scope:** Calibration frame support (dark/flat/bias), alignment/registration, or complex single-image workflows. imgstax is intentionally focused on sequential progressive stacking for animations.

## Author

Ed Caspersen

## Acknowledgments

- NumPy for array operations
- Pillow for image processing
- tqdm for progress visualization
