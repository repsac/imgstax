import numpy
from pathlib import Path
from typing import Callable, Optional
from dataclasses import dataclass, asdict


@dataclass
class StackConfig:
    """Configuration for image stacking operations."""
    input_path: Path
    output_path: Path
    prefix: str = 'stacked-'
    stacking_func: Callable = numpy.amax
    stacking_name: str = 'maximum'
    start_frame: Optional[int] = None
    end_frame: Optional[int] = None
    frame_interval: int = 1
    trail_length: int = 0
    fade_out: bool = False
    trail_gradient: bool = False
    gradient_decay: float = 0.85
    gradient_plateau: int = 0
    dryrun: bool = False
    quality: int = 100
    png_compress_level: int = 6
    tiff_compression: str = 'deflate'
    logfile: bool = False
    progress_json: bool = False

    def validate(self) -> None:
        """Validate configuration parameters.

        Raises:
            ValueError: If any configuration parameter is invalid
        """
        if not self.input_path.exists():
            raise ValueError(f"Input path does not exist: {self.input_path}")

        if self.trail_length < 0:
            raise ValueError(f"Trail length must be non-negative, got: {self.trail_length}")

        if self.frame_interval < 1:
            raise ValueError(f"Frame interval must be at least 1, got: {self.frame_interval}")

        if not 1 <= self.quality <= 100:
            raise ValueError(f"Quality must be between 1 and 100, got: {self.quality}")

        if not 0 <= self.png_compress_level <= 9:
            raise ValueError(f"PNG compress level must be between 0 and 9, got: {self.png_compress_level}")

        valid_tiff_compressions = ['none', 'lzw', 'deflate', 'jpeg']
        if self.tiff_compression not in valid_tiff_compressions:
            raise ValueError(
                f"TIFF compression must be one of {valid_tiff_compressions}, got: '{self.tiff_compression}'"
            )

        if self.start_frame is not None and self.start_frame < 0:
            raise ValueError(f"Start frame must be non-negative, got: {self.start_frame}")

        if self.end_frame is not None and self.end_frame < 0:
            raise ValueError(f"End frame must be non-negative, got: {self.end_frame}")

        if (self.start_frame is not None and self.end_frame is not None and
            self.start_frame > self.end_frame):
            raise ValueError(
                f"Start frame ({self.start_frame}) must be less than or equal to end frame ({self.end_frame})"
            )

        if self.trail_gradient and self.trail_length == 0:
            raise ValueError("Trail gradient requires trail_length > 0")

        if not 0.0 < self.gradient_decay <= 1.0:
            raise ValueError(f"Gradient decay must be between 0.0 and 1.0, got: {self.gradient_decay}")

        if self.gradient_plateau < 0:
            raise ValueError(f"Gradient plateau must be non-negative, got: {self.gradient_plateau}")

        if self.trail_length > 0 and self.gradient_plateau >= self.trail_length:
            raise ValueError(
                f"Gradient plateau ({self.gradient_plateau}) must be less than trail_length ({self.trail_length})"
            )

    def to_dict(self) -> dict:
        """Convert config to dictionary for JSON serialization.

        Returns:
            Dictionary representation with Path objects converted to strings
        """
        data = asdict(self)
        # Convert Path objects to strings
        data['input_path'] = str(self.input_path)
        data['output_path'] = str(self.output_path)
        # Remove the callable function object
        data.pop('stacking_func', None)
        return data
