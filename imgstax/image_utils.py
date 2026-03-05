import logging
import numpy
from pathlib import Path
from typing import List, Callable, Tuple, Union
from PIL import Image

try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False

logger = logging.getLogger(__name__)


def validate_image_dimensions(images: List[Path]) -> Tuple[int, int]:
    """Validate that all images have the same dimensions.

    Args:
        images: List of image file paths to validate

    Returns:
        Tuple of (width, height) for the validated images

    Raises:
        ValueError: If images have mismatched dimensions
    """
    if not images:
        raise ValueError("No images provided for validation")

    logger.info("Validating image dimensions...")
    with Image.open(images[0]) as first_img:
        dimensions = first_img.size
        logger.debug("Reference dimensions: %dx%d from %s", dimensions[0], dimensions[1], images[0])

    # Use tqdm if available
    image_iter = tqdm(images[1:], desc="Validating", unit="image") if HAS_TQDM else images[1:]

    for img_path in image_iter:
        try:
            with Image.open(img_path) as img:
                if img.size != dimensions:
                    raise ValueError(
                        f"Image dimension mismatch: {img_path.name} is {img.size[0]}x{img.size[1]}, "
                        f"expected {dimensions[0]}x{dimensions[1]}"
                    )
        except Exception as e:
            if isinstance(e, ValueError):
                raise
            raise ValueError(f"Failed to validate image {img_path.name}: {str(e)}") from e

    logger.info("All %d images validated with dimensions: %dx%d", len(images), dimensions[0], dimensions[1])
    return dimensions


def apply_gradient_weights(images_arrays: list,
                          gradient: bool = False,
                          decay_factor: float = 0.85,
                          plateau: int = 0,
                          stack_func: Callable = numpy.amax) -> numpy.ndarray:
    """Apply gradient weights to image arrays for comet tail effect.

    Args:
        images_arrays: List of numpy arrays (images)
        gradient: If True, apply progressive weighting
        decay_factor: Exponential decay rate (0.0-1.0, default 0.85)
        plateau: Number of newest frames at full intensity before decay (default 0)
        stack_func: Stacking function (numpy.amax or numpy.amin) to determine fade direction

    Returns:
        Weighted composite image as numpy array
    """
    if not gradient or len(images_arrays) == 1:
        # No gradient, use the stacking function
        return numpy.uint8(stack_func(images_arrays, axis=0))

    num_images = len(images_arrays)

    # Determine fade direction based on stacking function
    # For minimum: fade toward white (255) - makes dark objects lighter
    # For maximum: fade toward black (0) - makes bright objects darker
    is_minimum = stack_func == numpy.amin
    fade_target = 255.0 if is_minimum else 0.0

    weighted_images = []

    for i, img_array in enumerate(images_arrays):
        # Calculate position from newest (0 = newest, num_images-1 = oldest)
        position_from_newest = num_images - 1 - i

        # Apply plateau: newest N frames get weight 1.0
        if position_from_newest < plateau:
            weight = 1.0
        else:
            # Apply exponential decay after plateau
            decay_steps = position_from_newest - plateau
            weight = decay_factor ** decay_steps

        img_float = img_array.astype(numpy.float32)

        # Apply weighting: blend between original and fade target
        weighted_img = img_float * weight + fade_target * (1.0 - weight)
        weighted_images.append(weighted_img)

    # Apply stacking function (min or max) to weighted images
    result = stack_func(weighted_images, axis=0)
    return numpy.uint8(numpy.clip(result, 0, 255))


def stack_images(images: Union[Tuple[Path, ...], List[Path]],
                 output: Path,
                 stack_func: Callable,
                 dryrun: bool,
                 quality: int = 95,
                 png_compress_level: int = 6,
                 tiff_compression: str = 'deflate',
                 gradient: bool = False,
                 gradient_decay: float = 0.85,
                 gradient_plateau: int = 0) -> None:
    """Stack multiple images into one using the specified function.

    Args:
        images: List or tuple of image paths to stack
        output: Output file path
        stack_func: NumPy function to use for stacking (e.g., numpy.amax)
        dryrun: If True, skip actual image processing
        quality: JPEG quality (1-100)
        png_compress_level: PNG compression level (0-9, default: 6)
        tiff_compression: TIFF compression method ('none', 'lzw', 'deflate', 'jpeg')
        gradient: If True, apply gradient weighting (comet tail effect)
        gradient_decay: Exponential decay rate for gradient (0.0-1.0, default 0.85)
        gradient_plateau: Number of newest frames at full intensity (default 0)

    Raises:
        OSError: If unable to read/write image files
    """
    logger.info("Stacking %d images to %s", len(images), output)
    if gradient:
        logger.debug("Using gradient weighting for comet tail effect (decay=%.2f, plateau=%d)",
                    gradient_decay, gradient_plateau)

    ext = output.suffix[1:].lower()

    # Map file extensions to PIL format names (only when upper() doesn't match PIL format)
    # Supported formats: JPEG, PNG, TIFF, BMP, WEBP, TGA, PPM, PGM, PBM
    img_format = {
        'jpg': 'JPEG',
        'jpe': 'JPEG',
        'jfif': 'JPEG',
        'tif': 'TIFF',
        'dib': 'BMP'
    }.get(ext, ext.upper())
    logger.info("Image format '%s' mapped from extension '%s'", img_format, ext)

    if not dryrun:
        # Accept pre-decoded numpy arrays (from frame cache) or file paths
        if len(images) > 0 and isinstance(images[0], numpy.ndarray):
            images_arrays = list(images)
        else:
            images_arrays = []
            for img in images:
                with Image.open(img) as pil_img:
                    images_arrays.append(numpy.array(pil_img))

        # Apply gradient weighting if enabled
        if gradient:
            stacked = apply_gradient_weights(images_arrays, gradient=True,
                                            decay_factor=gradient_decay,
                                            plateau=gradient_plateau,
                                            stack_func=stack_func)
        else:
            stacked = numpy.uint8(stack_func(images_arrays, axis=0))

        newimg = Image.fromarray(stacked)

        # Save with appropriate options based on format
        save_kwargs = {'format': img_format}

        # Create TIFF compression mapping (CLI names to PIL names)
        tiff_compression_map = {
            'none': None,
            'lzw': 'tiff_lzw',
            'deflate': 'tiff_deflate',
            'jpeg': 'tiff_jpeg'
        }

        if img_format == 'JPEG':
            save_kwargs['quality'] = quality
            save_kwargs['optimize'] = True
        elif img_format == 'PNG':
            save_kwargs['optimize'] = True
            save_kwargs['compress_level'] = png_compress_level
        elif img_format == 'TIFF':
            pil_compression = tiff_compression_map.get(tiff_compression)
            if pil_compression is not None:
                save_kwargs['compression'] = pil_compression
            # If tiff_compression is 'jpeg', also pass quality
            if tiff_compression == 'jpeg':
                save_kwargs['quality'] = quality

        newimg.save(output, **save_kwargs)


def get_stacking_function(name: str) -> Tuple[Callable, str]:
    """Get NumPy stacking function by name.

    Args:
        name: Name of the stacking function

    Returns:
        Tuple of (function, canonical_name)

    Raises:
        ValueError: If the function name is not recognized
    """
    stacking = {
        'maximum': (numpy.amax, 'maximum'),
        'max': (numpy.amax, 'maximum'),
        'mean': (numpy.mean, 'mean'),
        'minimum': (numpy.amin, 'minimum'),
        'min': (numpy.amin, 'minimum'),
        'standard-deviation': (numpy.std, 'standard-deviation'),
        'summation': (numpy.sum, 'summation'),
        'variance': (numpy.var, 'variance'),
        'range': (numpy.ptp, 'range'),
        'median': (numpy.median, 'median')
    }

    if name not in stacking:
        available = ', '.join(sorted(set(k for k in stacking.keys() if len(k) > 3)))
        raise ValueError(
            f"Unknown stacking function: '{name}'. "
            f"Available options: {available}"
        )

    func, canonical_name = stacking[name]
    return func, canonical_name
