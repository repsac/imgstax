"""Setup script for imgstax package."""

import re
from setuptools import setup, find_packages
from pathlib import Path

# Read the contents of README file
readme_file = Path(__file__).parent / 'README.md'
long_description = readme_file.read_text(encoding='utf-8') if readme_file.exists() else ''


def read_version():
    """Read __version__ from imgstax/__init__.py.

    Parsed rather than imported so that building does not require the
    package's runtime dependencies to be installed. imgstax/__init__.py is
    the single source of truth for the Python package version; keeping a
    second copy here is what let the two drift apart.
    """
    init_file = Path(__file__).parent / 'imgstax' / '__init__.py'
    match = re.search(
        r"^__version__ = ['\"]([^'\"]+)['\"]",
        init_file.read_text(encoding='utf-8'),
        re.MULTILINE,
    )
    if not match:
        raise RuntimeError('Unable to find __version__ in imgstax/__init__.py')
    return match.group(1)

setup(
    name='imgstax',
    version=read_version(),
    author='Ed Caspersen',
    description='Image stacking tool for creating artistic effects and long exposures',
    long_description=long_description,
    long_description_content_type='text/markdown',
    url='https://github.com/repsac/imgstax',
    packages=find_packages(),
    classifiers=[
        'Development Status :: 4 - Beta',
        'Intended Audience :: Developers',
        'Intended Audience :: Science/Research',
        'License :: OSI Approved :: MIT License',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.9',
        'Programming Language :: Python :: 3.10',
        'Programming Language :: Python :: 3.11',
        'Topic :: Multimedia :: Graphics',
        'Topic :: Scientific/Engineering :: Image Processing',
    ],
    python_requires='>=3.9',
    install_requires=[
        'numpy>=1.20.0',
        'Pillow>=8.0.0',
    ],
    extras_require={
        'progress': ['tqdm>=4.60.0'],
        'video': ['opencv-python>=4.5.0'],
        'dev': [
            'pytest>=7.0.0',
            'pytest-cov>=3.0.0',
            'black>=22.0.0',
            'mypy>=0.950',
        ],
    },
    entry_points={
        'console_scripts': [
            'imgstax=imgstax.cli:main',
        ],
    },
)
