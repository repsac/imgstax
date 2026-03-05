import time
import shutil
import logging
import traceback
from collections import deque
from pathlib import Path

import numpy
from PIL import Image

try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False

from .config import StackConfig
from .file_utils import find_input_images, get_output_filepath
from .image_utils import validate_image_dimensions, stack_images

logger = logging.getLogger(__name__)


def _time_it(func):
    """Decorator to time function execution."""

    def wrapper(*args, **kwargs):
        start_time = time.time()

        try:
            result = func(*args, **kwargs)
            return result
        except Exception as err:
            logger.error("An error has occurred in '%s': %s", func.__name__, err)
            logger.error("Traceback:\n%s", traceback.format_exc())
            raise
        finally:
            end_time = time.time()
            total_time = end_time - start_time
            minutes, seconds = divmod(total_time, 60)
            logger.info("Function '%s' took %d minutes and %d seconds to complete",
                       func.__name__, int(minutes), int(seconds))

    return wrapper


def _progress(progress: int, total_images: int, current_file: str = None, json_mode: bool = False) -> None:
    """Log progress percentage or emit JSON progress.

    Args:
        progress: Current progress count
        total_images: Total number of images
        current_file: Name of current file being processed
        json_mode: If True, emit JSON; otherwise log normally
    """
    if json_mode:
        import json
        print(json.dumps({
            "type": "progress",
            "current": progress,
            "total": total_images,
            "file": current_file or ""
        }), flush=True)
    else:
        logger.info("Stacking progress: %.1f%%", ((progress / total_images) * 100))


@_time_it
def stack(config: StackConfig) -> None:
    """Stack images according to the provided configuration.

    Args:
        config: StackConfig object containing all stacking parameters

    Raises:
        ValueError: If configuration is invalid or insufficient images found
        OSError: If unable to read/write files
    """
    # Validate configuration
    config.validate()

    all_images = find_input_images(config.input_path)
    # Use inclusive end_frame by adding 1 to the slice endpoint
    end_idx = config.end_frame + 1 if config.end_frame is not None else None
    images = all_images[config.start_frame:end_idx:config.frame_interval]
    total_images = len(images)

    if total_images == 0:
        raise ValueError(
            f"No images remaining after applying slice [start_frame={config.start_frame}, "
            f"end_frame={config.end_frame} (inclusive), frame_interval={config.frame_interval}] to {len(all_images)} images"
        )

    if total_images == 1:
        raise ValueError(
            f"Only 1 image available after slice. Need at least 2 images for stacking. "
            f"Found {len(all_images)} total images, slice resulted in {total_images} image(s)"
        )

    logger.info("%d total images to process (from %d found)", total_images, len(all_images))

    # Validate all images have the same dimensions
    if not config.dryrun:
        validate_image_dimensions(images)

    ext = images[0].suffix
    stacked_images = [get_output_filepath(config.output_path, config.prefix, 1, ext)]

    message = "[DRYRUN] Copying" if config.dryrun else "Copying"
    logger.info("%s %s to %s", message, images[0], stacked_images[0])
    if not config.dryrun:
        shutil.copyfile(images[0], stacked_images[0])

    # Pre-populate frame cache for trail_length mode so each image is decoded once
    frame_cache = None
    if config.trail_length > 0 and not config.dryrun:
        frame_cache = deque(maxlen=config.trail_length)
        with Image.open(images[0]) as img:
            frame_cache.append(numpy.array(img))

    # Set up progress iterator
    if HAS_TQDM:
        iterator = tqdm(enumerate(images[1:], start=2),
                       total=len(images)-1,
                       desc="Stacking images",
                       unit="frame")
    else:
        iterator = enumerate(images[1:], start=2)

    for index, image in iterator:
        if not HAS_TQDM:
            _progress(index, total_images, image.name if config.progress_json else None, config.progress_json)

        stacked_images.append(get_output_filepath(config.output_path, config.prefix, index, ext))

        if config.trail_length > 0:
            # Read new frame once and add to cache (oldest frame evicted automatically)
            if not config.dryrun:
                with Image.open(image) as img:
                    frame_cache.append(numpy.array(img))

            # Determine effective window for fade-out
            if config.fade_out and index > total_images - config.trail_length:
                frames_from_end = total_images - index
                effective_trail_length = max(1, frames_from_end)
                logger.debug("Fade-out active: frame %d, using trail length %d (original: %d)",
                           index, effective_trail_length, config.trail_length)
                cached_arrays = list(frame_cache)[-effective_trail_length:]
            else:
                cached_arrays = list(frame_cache)

            stack_images(cached_arrays, stacked_images[-1], config.stacking_func, config.dryrun, config.quality, config.png_compress_level, config.tiff_compression, config.trail_gradient, config.gradient_decay, config.gradient_plateau)
        else:
            # No trail length — stack previous output with new image (2 file reads)
            if not HAS_TQDM:
                logger.info("Stacking %s with %d: %s", stacked_images[-2], index, image)
            subset_images = (stacked_images[-2], image)

            stack_images(subset_images, stacked_images[-1], config.stacking_func, config.dryrun, config.quality, config.png_compress_level, config.tiff_compression, config.trail_gradient, config.gradient_decay, config.gradient_plateau)

    # Emit completion message for JSON mode
    if config.progress_json:
        import json
        print(json.dumps({"type": "complete"}), flush=True)
