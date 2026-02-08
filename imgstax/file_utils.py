import logging
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)


def find_input_images(input_path: Path) -> List[Path]:
    """Find all supported image files in the input directory.

    Args:
        input_path: Path to directory containing images

    Returns:
        Sorted list of image file paths

    Raises:
        ValueError: If no valid images are found in the directory
        OSError: If unable to read the directory
    """
    images = []
    extensions = {'.jpg', '.jpeg', '.png', '.tif', '.tiff'}

    try:
        for filepath in input_path.iterdir():

            if filepath.name.startswith('.'):
                logger.debug("Skipping hidden file '%s'", filepath.name)
                continue

            if filepath.suffix.lower() not in extensions:
                logger.debug("Unsupported file extension on '%s'", filepath.name)
                continue

            if not filepath.is_file():
                logger.debug("Not a file, skipping '%s'", filepath.name)
                continue

            images.append(filepath)
    except PermissionError as e:
        raise OSError(f"Permission denied reading directory '{input_path}': {e}") from e
    except Exception as e:
        raise OSError(f"Error reading directory '{input_path}': {e}") from e

    if not images:
        supported = ', '.join(sorted(extensions))
        raise ValueError(
            f"No valid images found in '{input_path}'. "
            f"Supported formats: {supported}"
        )

    try:
        # Sort by filename (string) to avoid path comparison issues on Windows
        images.sort(key=lambda p: p.name.lower())
    except Exception as e:
        logger.error("Error sorting images: %s", e)
        # Fallback: try simple sort
        try:
            images.sort()
        except Exception as e2:
            logger.error("Fallback sort also failed: %s", e2)
            # Last resort: no sorting, just use directory order
            logger.warning("Using unsorted image list")

    logger.info("Found %d valid images in '%s'", len(images), input_path)
    return images


def get_output_filepath(output_path: Path, prefix: str, index: int, ext: str) -> Path:
    """Generate output file path for a stacked image.

    Args:
        output_path: Output directory
        prefix: Filename prefix
        index: Frame index
        ext: File extension

    Returns:
        Full path for the output file
    """
    return output_path / f'{prefix}{index:05d}{ext}'
