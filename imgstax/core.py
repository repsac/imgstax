import time
import logging
import traceback
from collections import deque

try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False

from .config import StackConfig
from .file_utils import find_input_images, get_output_filepath
from .image_utils import (
    ProgressiveStacker,
    load_image_array,
    save_image_array,
    stack_images,
    validate_image_dimensions,
)

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

    # Validate all images have the same dimensions and pick a common mode
    target_mode = 'RGB'
    if not config.dryrun:
        _, target_mode = validate_image_dimensions(images)

    ext = images[0].suffix
    stacked_images = [get_output_filepath(config.output_path, config.prefix, 1, ext)]

    message = "[DRYRUN] Copying" if config.dryrun else "Copying"
    logger.info("%s %s to %s", message, images[0], stacked_images[0])

    # Pre-populate frame cache (trail mode) or running accumulator (non-trail mode).
    # Frame 1 is decoded and re-encoded like every other frame so EXIF orientation
    # and encoding stay consistent across the whole sequence.
    frame_cache = None
    stacker = None
    if not config.dryrun:
        first_array = load_image_array(images[0], target_mode)
        save_image_array(first_array, stacked_images[0], config.quality,
                         config.png_compress_level, config.tiff_compression)
        if config.trail_length > 0:
            frame_cache = deque(maxlen=config.trail_length)
            frame_cache.append(first_array)
        else:
            stacker = ProgressiveStacker(config.stacking_name)
            stacker.add(first_array)

    # Set up progress iterator. tqdm is skipped in JSON mode so machine-readable
    # progress always reaches stdout.
    use_tqdm = HAS_TQDM and not config.progress_json
    if use_tqdm:
        iterator = tqdm(enumerate(images[1:], start=2),
                       total=len(images)-1,
                       desc="Stacking images",
                       unit="frame")
    else:
        iterator = enumerate(images[1:], start=2)

    for index, image in iterator:
        if not use_tqdm:
            _progress(index, total_images, image.name if config.progress_json else None, config.progress_json)

        stacked_images.append(get_output_filepath(config.output_path, config.prefix, index, ext))

        if config.dryrun:
            logger.info("[DRYRUN] Would stack %s to %s", image, stacked_images[-1])
            continue

        if config.trail_length > 0:
            # Read new frame once and add to cache (oldest frame evicted automatically)
            frame_cache.append(load_image_array(image, target_mode))

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
            # No trail length — accumulate in memory so composite N is the exact
            # stack of frames 1..N (and JPEG output avoids generational re-encoding)
            if not use_tqdm:
                logger.info("Stacking frame %d: %s", index, image)
            stacker.add(load_image_array(image, target_mode))
            save_image_array(stacker.composite(), stacked_images[-1], config.quality,
                             config.png_compress_level, config.tiff_compression)

    # Emit completion message for JSON mode
    if config.progress_json:
        import json
        print(json.dumps({"type": "complete"}), flush=True)
