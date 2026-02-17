"""Post-processing recipe loader and manager."""

import logging
import os
import yaml
from pathlib import Path
from typing import Dict, List, Optional, Any

logger = logging.getLogger(__name__)


class PostProcessingRecipeError(Exception):
    """Exception raised for post-processing recipe errors."""
    pass


def is_recipe_compatible(recipe: Dict[str, Any]) -> bool:
    """Check if a recipe is compatible with the current OS.

    Args:
        recipe: Recipe dictionary

    Returns:
        True if recipe is compatible with current OS
    """
    import platform

    recipe_os = recipe.get('os', 'all')

    # Handle 'all' - compatible with any OS
    if recipe_os == 'all' or recipe_os == ['all']:
        return True

    # Normalize to list for consistent handling
    if isinstance(recipe_os, str):
        recipe_os_list = [recipe_os.lower()]
    else:
        recipe_os_list = [os.lower() for os in recipe_os]

    system = platform.system().lower()

    # Map platform.system() to recipe OS names
    os_map = {
        'darwin': 'macos',
        'windows': 'windows',
        'linux': 'linux'
    }

    current_os = os_map.get(system, system)

    return current_os in recipe_os_list


def get_postproc_recipes_dir() -> Path:
    """Get the user's post-processing recipes directory.

    Creates directory if it doesn't exist.

    Returns:
        Path to post-processing recipes directory
    """
    import platform
    system = platform.system()

    if system == "Darwin":  # macOS
        base = Path.home() / "Library" / "Application Support"
    elif system == "Windows":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    else:  # Linux and others
        base = Path.home() / ".config"

    recipes_dir = base / "imgstax-desktop" / "postproc_recipes"
    recipes_dir.mkdir(parents=True, exist_ok=True)
    return recipes_dir


def get_builtin_postproc_recipes_dir() -> Optional[Path]:
    """Get the built-in post-processing recipes directory.

    Returns:
        Path to built-in recipes directory, or None if not found
    """
    # Check relative to this file
    module_dir = Path(__file__).parent
    builtin_dir = module_dir / "postproc_recipes"

    if builtin_dir.exists():
        return builtin_dir

    return None


def load_postproc_recipe(recipe_path: Path) -> Dict[str, Any]:
    """Load a post-processing recipe from YAML file.

    Args:
        recipe_path: Path to recipe YAML file

    Returns:
        Recipe dictionary

    Raises:
        PostProcessingRecipeError: If recipe is invalid
    """
    try:
        with open(recipe_path, 'r') as f:
            recipe = yaml.safe_load(f)

        if not isinstance(recipe, dict):
            raise PostProcessingRecipeError(f"Recipe must be a dictionary: {recipe_path}")

        # Validate required fields
        if 'name' not in recipe:
            raise PostProcessingRecipeError(f"Recipe missing 'name': {recipe_path}")

        if 'command' not in recipe:
            raise PostProcessingRecipeError(f"Recipe missing 'command': {recipe_path}")

        # Set defaults
        recipe.setdefault('description', '')
        recipe.setdefault('working_directory', 'output')
        recipe.setdefault('env_vars', {})
        recipe.setdefault('os', 'all')  # 'windows', 'macos', 'linux', or 'all'

        return recipe

    except yaml.YAMLError as e:
        raise PostProcessingRecipeError(f"Invalid YAML in {recipe_path}: {str(e)}")
    except Exception as e:
        raise PostProcessingRecipeError(f"Failed to load recipe {recipe_path}: {str(e)}")


def list_postproc_recipes() -> List[Dict[str, Any]]:
    """List all available post-processing recipes (built-in and user).

    Only returns recipes compatible with the current OS.

    Returns:
        List of recipe dictionaries with 'name', 'description', 'path', 'is_builtin', 'os'
    """
    recipes = []

    # Load built-in recipes
    builtin_dir = get_builtin_postproc_recipes_dir()
    if builtin_dir and builtin_dir.exists():
        for recipe_file in sorted(builtin_dir.glob("*.yaml")):
            try:
                recipe = load_postproc_recipe(recipe_file)
                # Only include if compatible with current OS
                if is_recipe_compatible(recipe):
                    recipes.append({
                        'name': recipe['name'],
                        'description': recipe.get('description', ''),
                        'path': str(recipe_file),
                        'is_builtin': True,
                        'os': recipe.get('os', 'all')
                    })
            except PostProcessingRecipeError as e:
                logger.warning(f"Skipping invalid built-in recipe {recipe_file}: {str(e)}")

    # Load user recipes
    user_dir = get_postproc_recipes_dir()
    for recipe_file in sorted(user_dir.glob("*.yaml")):
        try:
            recipe = load_postproc_recipe(recipe_file)
            # Only include if compatible with current OS
            if is_recipe_compatible(recipe):
                recipes.append({
                    'name': recipe['name'],
                    'description': recipe.get('description', ''),
                    'path': str(recipe_file),
                    'is_builtin': False,
                    'os': recipe.get('os', 'all')
                })
        except PostProcessingRecipeError as e:
            logger.warning(f"Skipping invalid user recipe {recipe_file}: {str(e)}")

    return recipes


def get_postproc_recipe_details(recipe_name: str) -> Optional[Dict[str, Any]]:
    """Get full details of a post-processing recipe by name.

    Args:
        recipe_name: Name of the recipe

    Returns:
        Recipe dictionary or None if not found
    """
    # Check built-in recipes
    builtin_dir = get_builtin_postproc_recipes_dir()
    if builtin_dir and builtin_dir.exists():
        for recipe_file in builtin_dir.glob("*.yaml"):
            try:
                recipe = load_postproc_recipe(recipe_file)
                if recipe['name'] == recipe_name:
                    recipe['path'] = str(recipe_file)
                    recipe['is_builtin'] = True
                    return recipe
            except PostProcessingRecipeError:
                continue

    # Check user recipes
    user_dir = get_postproc_recipes_dir()
    for recipe_file in user_dir.glob("*.yaml"):
        try:
            recipe = load_postproc_recipe(recipe_file)
            if recipe['name'] == recipe_name:
                recipe['path'] = str(recipe_file)
                recipe['is_builtin'] = False
                return recipe
        except PostProcessingRecipeError:
            continue

    return None


def save_postproc_recipe(recipe: Dict[str, Any], recipe_path: Optional[Path] = None) -> Path:
    """Save a post-processing recipe to YAML file.

    Args:
        recipe: Recipe dictionary
        recipe_path: Optional path to save to. If None, generates from name.

    Returns:
        Path where recipe was saved

    Raises:
        PostProcessingRecipeError: If recipe is invalid
    """
    # Validate required fields
    if 'name' not in recipe:
        raise PostProcessingRecipeError("Recipe must have a 'name'")

    if 'command' not in recipe:
        raise PostProcessingRecipeError("Recipe must have a 'command'")

    # Generate path if not provided
    if recipe_path is None:
        user_dir = get_postproc_recipes_dir()
        # Sanitize filename
        safe_name = "".join(c for c in recipe['name'] if c.isalnum() or c in (' ', '-', '_')).strip()
        safe_name = safe_name.replace(' ', '_')
        recipe_path = user_dir / f"{safe_name}.yaml"

    # Ensure directory exists
    recipe_path.parent.mkdir(parents=True, exist_ok=True)

    # Save recipe
    try:
        with open(recipe_path, 'w') as f:
            yaml.dump(recipe, f, default_flow_style=False, sort_keys=False)

        logger.info(f"Saved post-processing recipe '{recipe['name']}' to {recipe_path}")
        return recipe_path

    except Exception as e:
        raise PostProcessingRecipeError(f"Failed to save recipe: {str(e)}")


def delete_postproc_recipe(recipe_path: str) -> bool:
    """Delete a post-processing recipe file.

    Args:
        recipe_path: Path to recipe file

    Returns:
        True if deleted, False if file didn't exist

    Raises:
        PostProcessingRecipeError: If trying to delete built-in recipe
    """
    path = Path(recipe_path)

    # Prevent deleting built-in recipes
    builtin_dir = get_builtin_postproc_recipes_dir()
    if builtin_dir and path.is_relative_to(builtin_dir):
        raise PostProcessingRecipeError("Cannot delete built-in recipes")

    if not path.exists():
        return False

    try:
        os.remove(path)
        logger.info(f"Deleted post-processing recipe: {recipe_path}")
        return True
    except Exception as e:
        raise PostProcessingRecipeError(f"Failed to delete recipe: {str(e)}")
