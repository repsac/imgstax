# imgstax Recipes

This directory contains built-in recipe presets for common image stacking use cases.

## Using Recipes

```bash
# Use a built-in recipe
python -m imgstax images/ --recipe stars

# Override specific settings
python -m imgstax images/ --recipe stars --trail-length 50

# List all available recipes
python -m imgstax --list-recipes

# Use a custom recipe file
python -m imgstax images/ --recipe ~/my-recipes/custom.yaml
```

## Available Built-in Recipes

### stars
**Star Trail Photography**
- Stacking: maximum
- Trail length: 30
- Fade out: enabled
- Quality: 95
- Best for: Astrophotography, capturing star movement

### murmurations
**Bird Murmurations**
- Stacking: maximum
- Trail length: 15
- Fade out: enabled
- Quality: 90
- Best for: Bird flock movements, fluid motion capture

### traffic
**Traffic Light Trails**
- Stacking: maximum
- Trail length: 20
- Fade out: enabled
- Quality: 92
- Best for: Vehicle light trails, city traffic at night

### timelapse
**Time-lapse Effects**
- Stacking: mean
- Trail length: 5
- Fade out: disabled
- Quality: 85
- Step: 2
- Best for: Smooth time-lapse with subtle motion blur

### fireworks
**Fireworks Display**
- Stacking: maximum
- Trail length: 10
- Fade out: disabled
- Quality: 95
- Best for: Combining multiple firework bursts

### noise-reduction
**Noise Reduction**
- Stacking: mean
- Trail length: 0 (pure averaging)
- Fade out: disabled
- Quality: 95
- Best for: Reducing noise through averaging multiple exposures

## Creating Custom Recipes

### Custom Recipe Location

Place your custom recipes in:
- `~/.imgstax/recipes/` - User recipes (recommended)
- Current directory - Project-specific recipes
- Any path - Specify full path with `--recipe`

### Recipe File Format

Create a YAML file with this structure:

```yaml
# Recipe metadata
name: "My Custom Recipe"
description: "Description of what this recipe does"

# Settings (all optional)
settings:
  # Stacking function
  stacking: maximum  # Options: maximum, minimum, mean, median, etc.

  # Trail configuration
  trail_length: 20   # Number of frames to include in trail
  fade_out: true     # Fade out trails at end

  # Frame selection
  start: 0           # Starting frame index
  stop: 100          # Ending frame index
  step: 1            # Process every nth frame

  # Output quality
  quality: 95        # JPEG quality (1-100)
  prefix: "custom-"  # Output filename prefix

  # Other options
  dryrun: false      # Test run without creating files
  logfile: true      # Write log to file
```

### Example: Custom High-Speed Recipe

```yaml
name: "High-Speed Action"
description: "Short trails for fast-moving subjects"

settings:
  stacking: maximum
  trail_length: 5
  fade_out: false
  quality: 92
  step: 1
```

Save as `~/.imgstax/recipes/highspeed.yaml` and use with:
```bash
python -m imgstax action_images/ --recipe highspeed
```

### Example: Ultra Quality Recipe

```yaml
name: "Ultra Quality"
description: "Maximum quality settings for final output"

settings:
  stacking: mean
  trail_length: 0
  quality: 100
  step: 1
```

## Recipe Precedence

When using recipes with CLI arguments:

1. **Recipe settings** provide defaults
2. **CLI arguments** override recipe settings
3. **Built-in defaults** are used if neither is specified

Example:
```bash
# Recipe sets trail_length: 30
python -m imgstax images/ --recipe stars --trail-length 50
# Result: trail_length = 50 (CLI override)
```

## Tips

- Start with a built-in recipe and customize as needed
- Create project-specific recipes for consistent results
- Use descriptive names for custom recipes
- Add comments in YAML to document settings
- Test with `--dryrun` first

## Recipe Development

To create effective recipes:

1. **Test settings** with small image sets first
2. **Document** the use case in the description
3. **Provide examples** in comments
4. **Share** useful recipes with the community

## Sharing Recipes

To share your recipes:

1. Place in `~/.imgstax/recipes/` on target system
2. Or distribute YAML file and users specify path:
   ```bash
   python -m imgstax images/ --recipe /path/to/recipe.yaml
   ```

## Troubleshooting

**Recipe not found**
- Check spelling: `python -m imgstax --list-recipes`
- Ensure .yaml extension
- Verify file location

**Invalid YAML**
- Use a YAML validator
- Check indentation (use spaces, not tabs)
- Ensure settings is a dictionary

**Settings not working**
- Verify setting names match CLI arguments
- Check CLI overrides (they take precedence)
- Use `--logfile` to see which settings are active
