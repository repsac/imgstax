# imgstax - Image Stacking Tool

A powerful Python tool for stacking image sequences using various mathematical operations. Perfect for astrophotography, creating star trails, simulating long exposures, noise reduction, and artistic time-lapse effects.

## Features

### Core Functionality
- **Multiple Stacking Algorithms**: maximum, minimum, mean, median, standard deviation, summation, variance, and range
- **Progressive Stacking**: Creates a sequence where each frame is a stack of all previous frames
- **Trail Control**: Limit trail length for sliding window effects
- **Fade Out**: Gradually fade trails at the end of sequences
- **Frame Selection**: Start, stop, and step parameters for selective processing
- **Dry Run Mode**: Test operations without creating output files

### Enhanced Features (v2.0)
- **Type Hints**: Full type annotations for better IDE support
- **pathlib Support**: Modern Path-based file handling
- **Progress Bars**: Optional tqdm integration for visual progress (install with `pip install tqdm`)
- **Image Validation**: Automatic dimension validation prevents runtime errors
- **Quality Control**: Adjustable JPEG quality and PNG optimization
- **Better Error Messages**: Comprehensive error reporting
- **Modular Architecture**: Clean, maintainable codebase
- **Configuration Validation**: Early detection of invalid parameters

## Installation

### From Source
```bash
git clone https://github.com/edcaspersen/imgstax.git
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

Optional:
- tqdm >= 4.60.0 (for progress bars)

## Usage

### Basic Usage
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

| Recipe | Stacking | Trail | Best For |
|--------|----------|-------|----------|
| **stars** | maximum | 30 | Star trails, astrophotography |
| **murmurations** | maximum | 15 | Bird flocks, fluid motion |
| **traffic** | maximum | 20 | Vehicle light trails |
| **timelapse** | mean | 5 | Time-lapse with motion blur |
| **fireworks** | maximum | 10 | Firework composites |
| **noise-reduction** | mean | 0 | Noise reduction averaging |

### Overriding Recipe Settings

CLI arguments override recipe defaults:

```bash
# Use stars recipe but with longer trails
python -m imgstax images/ --recipe stars --trail-length 50

# Use traffic recipe with different quality
python -m imgstax images/ --recipe traffic -q 100
```

### Creating Custom Recipes

Create YAML files in `~/.imgstax/recipes/`:

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
  -q, --quality N       JPEG quality 1-100 (default: 95)
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

## Supported Image Formats

- JPEG (.jpg, .jpeg)
- PNG (.png)
- TIFF (.tif, .tiff)

## Programmatic Usage

```python
from pathlib import Path
from imgstax import StackConfig, stack
import numpy

# Create configuration
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
│   └── file_utils.py        # File I/O operations
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

### Astrophotography
- Star trail images
- Deep sky stacking for noise reduction
- Meteor shower composites
- Light pollution removal (median stacking)

### Photography
- Simulated long exposures
- People removal (median stacking)
- Light trail effects from traffic
- Fireworks composites

### Creative Effects
- Motion blur visualization
- Time compression
- Artistic trails

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

### v2.0.0 (Current)
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
- Video input/output support
- Parallel processing for speed improvements
- Resume capability for interrupted processes
- GUI interface
- Additional stacking algorithms
- Batch directory processing

## Author

Ed Caspersen

## Acknowledgments

- NumPy for array operations
- Pillow for image processing
- tqdm for progress visualization
