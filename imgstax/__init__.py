"""
imgstax - Image Stacking Tool

A Python package for stacking image sequences using various mathematical operations.
Commonly used for astrophotography, time-lapse processing, and artistic effects.
"""

import sys
import logging

__version__ = '2.0.0'
__author__ = 'Ed Caspersen'

# Set up logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
logger.addHandler(handler)

# Public API
from .config import StackConfig
from .core import stack
from .image_utils import get_stacking_function, validate_image_dimensions, stack_images
from .file_utils import find_input_images, get_output_filepath

__all__ = [
    'StackConfig',
    'stack',
    'get_stacking_function',
    'validate_image_dimensions',
    'stack_images',
    'find_input_images',
    'get_output_filepath',
]
