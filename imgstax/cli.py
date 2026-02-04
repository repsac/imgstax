import sys
import json
import logging
import argparse
import datetime
from pathlib import Path

from .config import StackConfig
from .image_utils import get_stacking_function
from .core import stack
from .recipe_loader import (
    load_recipe,
    get_recipe_details,
    RecipeError
)

logger = logging.getLogger(__name__)

PREFIX = 'stacked-'


def setup_output(config: StackConfig) -> None:
    """Set up output directory and metadata.

    Args:
        config: StackConfig object
    """
    if config.dryrun:
        return

    if not config.output_path.exists():
        logger.info("Creating output path %s", config.output_path)
        config.output_path.mkdir(parents=True, exist_ok=True)

    if config.output_path.exists():
        metadata = config.output_path / 'metadata.json'
        logger.info("Writing metadata to '%s'", metadata)
        config_dict = config.to_dict()

        for key, value in config_dict.items():
            logger.debug("Config: %s=%s", key, value)

        with open(metadata, 'w', encoding='utf-8') as filestream:
            json.dump(config_dict, filestream, indent=4)

    if config.logfile:
        logfile = config.output_path / 'output.log'
        handler = logging.FileHandler(logfile)
        handler.setFormatter(logger.handlers[0].formatter)
        logger.addHandler(handler)


def main() -> None:
    """Main entry point for the CLI."""
    parser = argparse.ArgumentParser(
        prog='imgstax',
        description='Stack image sequences with various mathematical operations'
    )

    parser.add_argument('input',
                        nargs='?',
                        help="Input directory containing the image sequences.")

    default_output = datetime.datetime.now().strftime('%y%m%d-%H%M%S')

    parser.add_argument('-o', '--output',
                        default=default_output,
                        help="Destination directory for the generated images.")

    parser.add_argument('--recipe',
                        help="Load settings from a recipe/preset (e.g., 'stars', 'murmurations', or path to custom YAML)")

    parser.add_argument('--list-recipes',
                        action='store_true',
                        help="List all available recipes and exit")

    parser.add_argument('--dryrun',
                        action=argparse.BooleanOptionalAction,
                        help="Testing only, does not create any files or folders.")

    parser.add_argument('-p', '--prefix',
                        default=PREFIX,
                        help="File name prefix for the stacked images.")

    parser.add_argument('-s', '--stacking',
                        default='maximum',
                        help="Declare the stacking function to process images with.")

    parser.add_argument('-l', '--logfile',
                        action=argparse.BooleanOptionalAction,
                        help="Store all log output to file")

    parser.add_argument('--start',
                        type=int,
                        help="In (start) frame to begin the stack with")

    parser.add_argument('--stop',
                        type=int,
                        help="Out (stop) frame to end the stack with")

    parser.add_argument('--step',
                        type=int,
                        help="Skip every nth frame in the image sequence")

    parser.add_argument('-t', '--trail-length',
                        type=int,
                        default=0,
                        help="Limit the length of the trails.")

    parser.add_argument('-f', '--fade-out',
                        action=argparse.BooleanOptionalAction,
                        help="Fade out the trails, only works with trail length")

    parser.add_argument('-g', '--trail-gradient',
                        action=argparse.BooleanOptionalAction,
                        help="Apply gradient to trail (comet tail effect - older frames fade progressively)")

    parser.add_argument('-q', '--quality',
                        type=int,
                        default=95,
                        help="JPEG output quality (1-100, default: 95)")

    args = parser.parse_args()

    # Handle --list-recipes
    if args.list_recipes:
        print("\nAvailable Recipes:\n")
        recipes = get_recipe_details()
        if not recipes:
            print("No recipes found.")
            print(f"\nBuilt-in recipes should be in: {Path(__file__).parent / 'recipes'}")
            print(f"User recipes can be placed in: ~/.imgstax/recipes/")
        else:
            for recipe in recipes:
                print(f"  {recipe['id']:<20} - {recipe['description']}")
                print(f"    Name: {recipe['name']}")
                print(f"    Type: {recipe['type']}")
                print()
        sys.exit(0)

    # Validate input is provided (unless listing recipes)
    if not args.input:
        parser.error("the following arguments are required: input")

    # Load recipe if specified
    recipe_settings = {}
    if args.recipe:
        try:
            recipe = load_recipe(args.recipe)
            logger.info(f"Loaded recipe: {recipe.name}")
            logger.info(f"Description: {recipe.description}")
            recipe_settings = recipe.settings
        except RecipeError as e:
            logger.error(str(e))
            sys.exit(1)

    # Get stacking function (from recipe or CLI)
    stacking_name = args.stacking if args.stacking != 'maximum' else recipe_settings.get('stacking', 'maximum')
    try:
        stacking_func, stacking_name = get_stacking_function(stacking_name)
    except ValueError as e:
        logger.error(str(e))
        sys.exit(1)

    # Merge settings: recipe defaults, then CLI overrides
    # CLI arguments that are not None take precedence
    def get_setting(cli_value, recipe_key, default):
        """Get setting from CLI, recipe, or default (in that order)."""
        if cli_value is not None:
            return cli_value
        return recipe_settings.get(recipe_key, default)

    # Handle output path - auto-prefix with "export_" if in current directory
    output_path = Path(args.output)

    # If output is relative and in current directory, prefix with "export_"
    if not output_path.is_absolute():
        # Check if it's a simple directory name (no parent directories)
        if output_path.parent == Path('.'):
            # Don't double-prefix if already starts with export_
            if not output_path.name.startswith('export_'):
                output_path = Path(f'export_{output_path.name}')
                logger.info(f"Output directory auto-prefixed: {output_path}")
                logger.info("This prevents accidental git commits (see .gitignore)")

    # Create configuration object
    config = StackConfig(
        input_path=Path(args.input),
        output_path=output_path,
        prefix=get_setting(args.prefix if args.prefix != PREFIX else None, 'prefix', PREFIX),
        stacking_func=stacking_func,
        stacking_name=stacking_name,
        start=get_setting(args.start, 'start', None),
        stop=get_setting(args.stop, 'stop', None),
        step=get_setting(args.step, 'step', 1),
        trail_length=get_setting(args.trail_length if args.trail_length != 0 else None, 'trail_length', 0),
        fade_out=get_setting(args.fade_out, 'fade_out', False),
        trail_gradient=get_setting(args.trail_gradient, 'trail_gradient', False),
        dryrun=get_setting(args.dryrun, 'dryrun', False),
        quality=get_setting(args.quality if args.quality != 95 else None, 'quality', 95),
        logfile=get_setting(args.logfile, 'logfile', False)
    )

    # Set up output directory and logging
    setup_output(config)

    # Run the stacking process
    try:
        stack(config)
    except (ValueError, OSError) as e:
        logger.error("Error: %s", e)
        sys.exit(1)
    except Exception as e:
        logger.error("Unexpected error: %s", e)
        raise


if __name__ == '__main__':
    main()
