import yaml
import logging
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import asdict

logger = logging.getLogger(__name__)


class RecipeError(Exception):
    """Exception raised for recipe-related errors."""
    pass


class Recipe:
    """Represents a recipe/preset configuration."""

    def __init__(self, name: str, description: str, settings: Dict[str, Any], path: Optional[Path] = None):
        """Initialize a recipe.

        Args:
            name: Recipe name
            description: Recipe description
            settings: Dictionary of configuration settings
            path: Path to recipe file (if loaded from file)
        """
        self.name = name
        self.description = description
        self.settings = settings
        self.path = path

    @classmethod
    def from_yaml(cls, path: Path) -> 'Recipe':
        """Load recipe from YAML file.

        Args:
            path: Path to YAML file

        Returns:
            Recipe instance

        Raises:
            RecipeError: If file cannot be loaded or is invalid
        """
        try:
            with open(path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)

            if not isinstance(data, dict):
                raise RecipeError(f"Recipe file must contain a YAML dictionary: {path}")

            name = data.get('name', path.stem)
            description = data.get('description', '')
            settings = data.get('settings', {})

            if not isinstance(settings, dict):
                raise RecipeError(f"Recipe 'settings' must be a dictionary: {path}")

            return cls(name=name, description=description, settings=settings, path=path)

        except yaml.YAMLError as e:
            raise RecipeError(f"Invalid YAML in recipe file {path}: {e}") from e
        except Exception as e:
            raise RecipeError(f"Failed to load recipe from {path}: {e}") from e

    def __repr__(self) -> str:
        return f"Recipe(name='{self.name}', settings={len(self.settings)} items)"


def get_builtin_recipes_dir() -> Path:
    """Get the directory containing built-in recipes.

    Returns:
        Path to built-in recipes directory
    """
    # Recipes are in the same directory as this module
    return Path(__file__).parent / 'recipes'


def get_user_recipes_dir() -> Path:
    """Get the user's recipes directory.

    Returns:
        Path to user recipes directory (~/.imgstax/recipes/)
    """
    return Path.home() / '.imgstax' / 'recipes'


def find_recipe_file(recipe_name: str) -> Optional[Path]:
    """Find a recipe file by name.

    Searches in order:
    1. Exact path (if recipe_name is a file path)
    2. User recipes directory (~/.imgstax/recipes/)
    3. Built-in recipes directory
    4. Current working directory

    Args:
        recipe_name: Name of recipe or path to recipe file

    Returns:
        Path to recipe file, or None if not found
    """
    # Check if it's an explicit path
    recipe_path = Path(recipe_name)
    if recipe_path.exists() and recipe_path.is_file():
        return recipe_path

    # Add .yaml extension if not present
    if not recipe_name.endswith('.yaml') and not recipe_name.endswith('.yml'):
        recipe_name = f"{recipe_name}.yaml"

    # Search in user recipes
    user_recipes = get_user_recipes_dir()
    user_recipe = user_recipes / recipe_name
    if user_recipe.exists():
        logger.debug(f"Found user recipe: {user_recipe}")
        return user_recipe

    # Search in built-in recipes
    builtin_recipes = get_builtin_recipes_dir()
    builtin_recipe = builtin_recipes / recipe_name
    if builtin_recipe.exists():
        logger.debug(f"Found built-in recipe: {builtin_recipe}")
        return builtin_recipe

    # Search in current directory
    local_recipe = Path.cwd() / recipe_name
    if local_recipe.exists():
        logger.debug(f"Found local recipe: {local_recipe}")
        return local_recipe

    return None


def load_recipe(recipe_name: str) -> Recipe:
    """Load a recipe by name or path.

    Args:
        recipe_name: Name of recipe or path to recipe file

    Returns:
        Recipe instance

    Raises:
        RecipeError: If recipe cannot be found or loaded
    """
    recipe_path = find_recipe_file(recipe_name)

    if not recipe_path:
        available = list_available_recipes()
        recipes_str = ', '.join(available) if available else 'none'
        raise RecipeError(
            f"Recipe '{recipe_name}' not found. "
            f"Available recipes: {recipes_str}. "
            f"You can also specify a path to a custom recipe file."
        )

    logger.info(f"Loading recipe from: {recipe_path}")
    return Recipe.from_yaml(recipe_path)


def list_available_recipes() -> List[str]:
    """List all available recipe names.

    Returns:
        List of recipe names (without .yaml extension)
    """
    recipes = []

    # Built-in recipes
    builtin_dir = get_builtin_recipes_dir()
    if builtin_dir.exists():
        for recipe_file in builtin_dir.glob('*.yaml'):
            recipes.append(recipe_file.stem)

    # User recipes
    user_dir = get_user_recipes_dir()
    if user_dir.exists():
        for recipe_file in user_dir.glob('*.yaml'):
            # Don't duplicate if user overrides built-in
            if recipe_file.stem not in recipes:
                recipes.append(recipe_file.stem)

    return sorted(recipes)


def get_recipe_details() -> List[Dict[str, str]]:
    """Get detailed information about all available recipes.

    Returns:
        List of dictionaries with recipe details (name, description, path)
    """
    details = []

    # Built-in recipes
    builtin_dir = get_builtin_recipes_dir()
    if builtin_dir.exists():
        for recipe_file in builtin_dir.glob('*.yaml'):
            try:
                recipe = Recipe.from_yaml(recipe_file)
                details.append({
                    'name': recipe.name,
                    'id': recipe_file.stem,
                    'description': recipe.description,
                    'path': str(recipe_file),
                    'type': 'built-in'
                })
            except RecipeError:
                pass  # Skip invalid recipes

    # User recipes
    user_dir = get_user_recipes_dir()
    if user_dir.exists():
        for recipe_file in user_dir.glob('*.yaml'):
            try:
                recipe = Recipe.from_yaml(recipe_file)
                # Check if it overrides a built-in
                is_override = any(d['id'] == recipe_file.stem and d['type'] == 'built-in' for d in details)
                details.append({
                    'name': recipe.name,
                    'id': recipe_file.stem,
                    'description': recipe.description,
                    'path': str(recipe_file),
                    'type': 'user (override)' if is_override else 'user'
                })
            except RecipeError:
                pass  # Skip invalid recipes

    return sorted(details, key=lambda x: x['id'])


def create_user_recipes_dir() -> Path:
    """Create the user recipes directory if it doesn't exist.

    Returns:
        Path to user recipes directory
    """
    user_dir = get_user_recipes_dir()
    user_dir.mkdir(parents=True, exist_ok=True)
    return user_dir


def merge_recipe_with_args(recipe: Recipe, args_dict: Dict[str, Any]) -> Dict[str, Any]:
    """Merge recipe settings with command-line arguments.

    Command-line arguments take precedence over recipe settings.
    Only non-None CLI arguments override recipe values.

    Args:
        recipe: Recipe instance
        args_dict: Dictionary of command-line arguments

    Returns:
        Merged configuration dictionary
    """
    # Start with recipe settings
    merged = recipe.settings.copy()

    # Override with non-None CLI arguments
    for key, value in args_dict.items():
        if value is not None:
            merged[key] = value
            logger.debug(f"CLI argument '{key}={value}' overrides recipe setting")

    return merged
