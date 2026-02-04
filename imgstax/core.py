import time
import shutil
import logging
import traceback
from pathlib import Path

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


def _progress(progress: int, total_images: int) -> None:
    """Log progress percentage.

    Args:
        progress: Current progress count
        total_images: Total number of images
    """
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
    images = all_images[config.start:config.stop:config.step]
    total_images = len(images)

    if total_images == 0:
        raise ValueError(
            f"No images remaining after applying slice [start={config.start}, "
            f"stop={config.stop}, step={config.step}] to {len(all_images)} images"
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
            _progress(index, total_images)

        stacked_images.append(get_output_filepath(config.output_path, config.prefix, index, ext))

        # Calculate effective trail length for fade-out
        if config.trail_length > 0:
            if config.fade_out and index > total_images - config.trail_length:
                # Gradually reduce trail length in final frames
                frames_from_end = total_images - index
                effective_trail_length = max(1, frames_from_end)
                logger.debug("Fade-out active: frame %d, using trail length %d (original: %d)",
                           index, effective_trail_length, config.trail_length)
            else:
                effective_trail_length = config.trail_length

            # Use sliding window with effective trail length
            if index-1 > effective_trail_length:
                start_idx = index - effective_trail_length
                logger.debug("Slicing image list [%d:%d]", start_idx, index)
                subset_images = images[start_idx:index]
                if not HAS_TQDM:
                    logger.info("Input file start at %s and ending %s", subset_images[0], subset_images[-1])
            else:
                # Stack with previous stacked image
                if not HAS_TQDM:
                    logger.info("Stacking %s with %d: %s", stacked_images[-2], index, image)
                subset_images = (stacked_images[-2], image)
        else:
            # No trail length specified - stack with previous stacked image
            if not HAS_TQDM:
                logger.info("Stacking %s with %d: %s", stacked_images[-2], index, image)
            subset_images = (stacked_images[-2], image)

        stack_images(subset_images, stacked_images[-1], config.stacking_func, config.dryrun, config.quality, config.trail_gradient, config.gradient_decay, config.gradient_plateau)
