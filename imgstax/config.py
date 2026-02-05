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
    start: Optional[int] = None
    stop: Optional[int] = None
    step: int = 1
    trail_length: int = 0
    fade_out: bool = False
    trail_gradient: bool = False
    gradient_decay: float = 0.85
    gradient_plateau: int = 0
    dryrun: bool = False
    quality: int = 95
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

        if self.step < 1:
            raise ValueError(f"Step must be at least 1, got: {self.step}")

        if not 1 <= self.quality <= 100:
            raise ValueError(f"Quality must be between 1 and 100, got: {self.quality}")

        if self.start is not None and self.start < 0:
            raise ValueError(f"Start frame must be non-negative, got: {self.start}")

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
