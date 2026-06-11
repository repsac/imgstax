import logging
import numpy
from pathlib import Path
from typing import List, Callable, Tuple, Union
from PIL import Image, ImageOps

try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False

logger = logging.getLogger(__name__)

# Modes that carry no color information; everything else is normalized to RGB
GRAYSCALE_MODES = {'1', 'L', 'I', 'F', 'I;16', 'I;16L', 'I;16B', 'I;16N'}
HIGH_DEPTH_MODES = {'I', 'F', 'I;16', 'I;16L', 'I;16B', 'I;16N'}


def validate_image_dimensions(images: List[Path]) -> Tuple[Tuple[int, int], str]:
    """Validate that all images have the same dimensions and pick a target mode.

    Args:
        images: List of image file paths to validate

    Returns:
        Tuple of ((width, height), target_mode) where target_mode is 'RGB' if
        any image carries color (or alpha/palette) data, otherwise 'L'

    Raises:
        ValueError: If images have mismatched dimensions
    """
    if not images:
        raise ValueError("No images provided for validation")

    logger.info("Validating image dimensions...")
    with Image.open(images[0]) as first_img:
        dimensions = first_img.size
        modes = {first_img.mode}
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
                modes.add(img.mode)
        except Exception as e:
            if isinstance(e, ValueError):
                raise
            raise ValueError(f"Failed to validate image {img_path.name}: {str(e)}") from e

    target_mode = 'L' if modes <= GRAYSCALE_MODES else 'RGB'
    if modes & HIGH_DEPTH_MODES:
        logger.warning("High bit-depth images detected (%s); they will be scaled to 8-bit for stacking",
                       ', '.join(sorted(modes & HIGH_DEPTH_MODES)))
    if len(modes) > 1:
        logger.info("Mixed image modes detected (%s); all frames will be converted to %s",
                    ', '.join(sorted(modes)), target_mode)

    logger.info("All %d images validated with dimensions: %dx%d", len(images), dimensions[0], dimensions[1])
    return dimensions, target_mode


def load_image_array(path: Path, target_mode: str = 'RGB') -> numpy.ndarray:
    """Load an image as a uint8 numpy array in a consistent mode.

    Applies EXIF orientation, scales 16/32-bit images down to 8-bit, and
    converts palette/alpha/CMYK images so every frame stacks compatibly.

    Args:
        path: Image file path
        target_mode: PIL mode every frame is converted to ('RGB' or 'L')

    Returns:
        uint8 numpy array of shape (H, W) for 'L' or (H, W, 3) for 'RGB'
    """
    with Image.open(path) as img:
        img = ImageOps.exif_transpose(img)

        if img.mode in ('I;16', 'I;16L', 'I;16B', 'I;16N'):
            arr = numpy.asarray(img, dtype=numpy.uint16)
            img = Image.fromarray((arr >> 8).astype(numpy.uint8), mode='L')
        elif img.mode in ('I', 'F'):
            arr = numpy.asarray(img, dtype=numpy.float64)
            arr = numpy.clip(arr, 0, 65535)
            img = Image.fromarray((arr / 257.0).astype(numpy.uint8), mode='L')

        if img.mode != target_mode:
            img = img.convert(target_mode)

        return numpy.array(img)


def save_image_array(array: numpy.ndarray,
                     output: Path,
                     quality: int = 100,
                     png_compress_level: int = 6,
                     tiff_compression: str = 'deflate') -> None:
    """Save a uint8 numpy array to disk with format-appropriate options.

    Args:
        array: uint8 image array
        output: Output file path (format inferred from extension)
        quality: JPEG quality (1-100)
        png_compress_level: PNG compression level (0-9)
        tiff_compression: TIFF compression method ('none', 'lzw', 'deflate', 'jpeg')
    """
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

    Image.fromarray(array).save(output, **save_kwargs)


class ProgressiveStacker:
    """Incrementally accumulates frames so each progressive composite is exact.

    Stacking the previous *output* with each new frame is only correct for
    idempotent extremal operations (max/min); for mean/sum/variance/etc. it
    produces exponentially-weighted nonsense. This keeps the minimal running
    state per function so composite N is the true stack of frames 1..N.
    """

    def __init__(self, name: str):
        self.name = name
        self.count = 0
        self._extremal = None      # maximum / minimum
        self._min = None           # range
        self._max = None           # range
        self._sum = None           # summation / mean
        self._mean = None          # Welford (variance / standard-deviation)
        self._m2 = None            # Welford
        self._frames = None        # median (needs every frame)
        if name == 'median':
            self._frames = []
            logger.warning("Progressive median keeps all frames in memory; "
                           "consider --trail-length to bound memory on long sequences")

    def add(self, frame: numpy.ndarray) -> None:
        """Accumulate one frame (uint8 array)."""
        self.count += 1
        if self.name in ('maximum', 'minimum'):
            if self._extremal is None:
                self._extremal = frame.copy()
            elif self.name == 'maximum':
                numpy.maximum(self._extremal, frame, out=self._extremal)
            else:
                numpy.minimum(self._extremal, frame, out=self._extremal)
        elif self.name == 'range':
            if self._min is None:
                self._min = frame.copy()
                self._max = frame.copy()
            else:
                numpy.minimum(self._min, frame, out=self._min)
                numpy.maximum(self._max, frame, out=self._max)
        elif self.name in ('summation', 'mean'):
            frame64 = frame.astype(numpy.float64)
            if self._sum is None:
                self._sum = frame64
            else:
                self._sum += frame64
        elif self.name in ('variance', 'standard-deviation'):
            frame64 = frame.astype(numpy.float64)
            if self._mean is None:
                self._mean = frame64
                self._m2 = numpy.zeros_like(frame64)
            else:
                delta = frame64 - self._mean
                self._mean += delta / self.count
                self._m2 += delta * (frame64 - self._mean)
        elif self.name == 'median':
            self._frames.append(frame)
        else:
            raise ValueError(f"Unsupported stacking function for progressive mode: '{self.name}'")

    def composite(self) -> numpy.ndarray:
        """Return the current composite of all accumulated frames as uint8."""
        if self.count == 0:
            raise ValueError("No frames accumulated")
        if self.name in ('maximum', 'minimum'):
            result = self._extremal
        elif self.name == 'range':
            result = self._max.astype(numpy.int16) - self._min
        elif self.name == 'summation':
            result = self._sum
        elif self.name == 'mean':
            result = self._sum / self.count
        elif self.name == 'variance':
            result = self._m2 / self.count
        elif self.name == 'standard-deviation':
            result = numpy.sqrt(self._m2 / self.count)
        else:  # median
            result = numpy.median(numpy.stack(self._frames), axis=0)
        return numpy.clip(result, 0, 255).astype(numpy.uint8)


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
        # No gradient, use the stacking function (clip so sum-like functions
        # saturate instead of wrapping modulo 256)
        return numpy.clip(stack_func(images_arrays, axis=0), 0, 255).astype(numpy.uint8)

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

    if not dryrun:
        # Accept pre-decoded numpy arrays (from frame cache) or file paths
        if len(images) > 0 and isinstance(images[0], numpy.ndarray):
            images_arrays = list(images)
        else:
            images_arrays = [load_image_array(img) for img in images]

        # Apply gradient weighting if enabled
        if gradient:
            stacked = apply_gradient_weights(images_arrays, gradient=True,
                                            decay_factor=gradient_decay,
                                            plateau=gradient_plateau,
                                            stack_func=stack_func)
        else:
            stacked = numpy.clip(stack_func(images_arrays, axis=0), 0, 255).astype(numpy.uint8)

        save_image_array(stacked, output, quality, png_compress_level, tiff_compression)


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
