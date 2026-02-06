# Recipe Editor Implementation Summary

## Overview
A comprehensive Recipe Editor has been added to the imgstax Desktop GUI, allowing users to create, edit, and delete custom recipes through an elegant dialog interface.

## Implementation Details

### Backend (Rust)
**File**: `desktop-app/src-tauri/src/lib.rs`

Added four new Tauri commands:
- `list_user_recipes` - Lists all user-created recipes
- `load_user_recipe` - Loads YAML content of a specific recipe
- `save_user_recipe` - Saves recipe to user's config directory
- `delete_user_recipe` - Deletes a user recipe

**Storage Locations** (OS-appropriate):
- macOS: `~/Library/Application Support/imgstax-desktop/user_recipes/`
- Linux: `~/.config/imgstax-desktop/user_recipes/`
- Windows: `%APPDATA%/imgstax-desktop/user_recipes/`

**Dependencies Added**:
- `serde_yaml = "0.9"` in Cargo.toml

### Frontend

#### HTML (`dist/index.html`)
- Added recipe editor dialog with comprehensive form fields:
  - Recipe ID (validated lowercase/numbers/hyphens)
  - Name and description
  - All stacking settings (method, quality, format options)
  - Frame and trail settings
  - Save, Delete, and Cancel buttons
- Included js-yaml CDN library for YAML parsing

#### JavaScript (`dist/main.js`)
New functions:
- `openRecipeEditor(recipeId)` - Opens editor in new or edit mode
- `closeRecipeEditor()` - Closes the dialog
- `saveRecipe()` - Validates and saves recipes as YAML
- `deleteRecipe()` - Deletes recipes with confirmation
- `refreshRecipeDropdown()` - Updates dropdown with user recipes

Modified functions:
- Recipe dropdown handler now detects:
  - `__editor__` value to open editor
  - `user:*` prefix to load user recipes
  - Built-in recipe IDs to use templates

#### CSS (`dist/styles.css`)
- Added `.recipe-editor-section` styles
- Added `#recipeEditorDialog` dialog styling (matches preferences)
- Added `.recipe-editor-actions` button layout
- Added textarea styling for description field

## Recipe Dropdown Structure

```
Custom settings...
────────────
✎ Recipe Editor
────────────
Star Trails
Bird Murmurations
Traffic Light Trails
Time-Lapse
Fireworks
Noise Reduction
────────────
My Recipe (User)
Another Recipe (User)
```

## Features

1. **Create Custom Recipes**: Click "✎ Recipe Editor" to create new recipes
2. **Edit User Recipes**: Select user recipe from dropdown, click Edit button
3. **Preview All Recipes**: Menu-based preview browser with search/filter for both built-in and user recipes
4. **Recipe Search**: Real-time search filter in preview dialog to quickly find recipes in large collections
5. **Duplicate Recipes**: Duplicate button creates a copy with " (Copy)" suffix
6. **Delete Recipes**: Delete button appears when editing (with confirmation)
7. **Import/Export Recipes**: Export recipes to YAML files, import from other users
8. **Load User Recipes**: Select from dropdown like built-in recipes
9. **Real-time Validation**: Input validation with visual feedback for all numeric fields
10. **YAML Format**: Compatible with CLI recipe system

## Testing Checklist

### Basic Functionality
- [ ] Open recipe editor from dropdown
- [ ] Create new recipe with all fields
- [ ] Save recipe successfully
- [ ] Recipe appears in dropdown with "(User)" suffix
- [ ] Load user recipe from dropdown
- [ ] Preview and Edit buttons appear when user recipe selected
- [ ] Preview recipe shows read-only summary of all settings
- [ ] Preview dialog displays correct values for all fields
- [ ] "Edit Recipe" button in preview opens recipe editor
- [ ] ESC key closes preview dialog
- [ ] Edit existing user recipe (Edit button opens recipe editor)
- [ ] Duplicate recipe creates copy with " (Copy)" suffix
- [ ] Duplicated recipe opens in editor for immediate editing
- [ ] Export recipe to YAML file with suggested filename
- [ ] Import recipe from YAML file
- [ ] Imported recipe gets " (Imported)" suffix and new UUID
- [ ] Imported recipe opens in editor for review before final save
- [ ] Delete user recipe with confirmation showing recipe name
- [ ] Cancel editor without saving
- [ ] ESC key closes recipe editor and preferences dialogs

### Validation
- [ ] Required field validation (recipe name)
- [ ] Quality field validates range (1-100)
- [ ] PNG compression validates range (0-9)
- [ ] Gradient decay validates range (0.0-1.0)
- [ ] Trail length validates (>= 0)
- [ ] Frame interval validates (>= 1)
- [ ] Gradient plateau validates (>= 0)
- [ ] Visual error messages appear with red borders
- [ ] Error messages clear when values become valid
- [ ] Save button prevented when validation errors exist
- [ ] YAML generation is valid
- [ ] User recipes stored in correct OS location
- [ ] UUIDs generated automatically (hidden from user)

### Recipe Search/Filter
- [ ] Open preview dialog shows search input
- [ ] Search input filters recipes in real-time as you type
- [ ] Search matches recipe names (case-insensitive)
- [ ] Search works for both built-in and user recipes
- [ ] Clearing search shows all recipes again
- [ ] Dividers hide when no recipes in section match search
- [ ] Search input clears when dialog opens
- [ ] Search input clears when dialog closes

### Integration
- [ ] User recipes work with main form
- [ ] All recipe settings apply correctly
- [ ] Recipe editor styling matches theme
- [ ] Recipe dropdown refreshes after save/delete

### Edge Cases
- [ ] Delete recipe while it's selected in main form
- [ ] Duplicate recipe multiple times (creates "Recipe (Copy)", "Recipe (Copy) (Copy)", etc.)
- [ ] Very long recipe names/descriptions
- [ ] Special characters in descriptions
- [ ] Duplicate then immediately duplicate again

## Known Limitations

1. **CLI Integration**: User recipes created in GUI won't automatically appear in CLI unless stored in `~/.imgstax/recipes/`

## Documentation Updates

- [x] README.md - Added Desktop GUI section with Recipe Editor details
- [x] README.md - Added recipe storage locations for all platforms
- [x] MEMORY.md - Documented Recipe Editor implementation details

## Next Steps (Optional Enhancements)

1. ✅ ~~Add context menu or edit button for user recipes~~ **COMPLETED**
   - Edit button appears when user recipe is selected
   - Opens recipe editor with existing recipe loaded
   - UUID-based system (no manual ID entry)
   - ESC key support for closing dialogs
2. ✅ ~~Add recipe preview/summary view~~ **COMPLETED**
   - Preview button appears when user recipe is selected
   - Opens read-only dialog showing all recipe settings
   - "Edit Recipe" button in preview to open editor
   - ESC key closes preview dialog
3. ✅ ~~Add recipe import/export functionality~~ **COMPLETED**
   - Export button in recipe editor saves YAML to chosen location
   - Import option in recipe dropdown loads YAML from file
   - Imported recipes get new UUID and " (Imported)" suffix
   - Opens in editor for review before final save
4. Sync user recipes between GUI and CLI locations
5. ✅ ~~Add recipe search/filter for large collections~~ **COMPLETED**
   - Search input field in preview dialog
   - Real-time filtering as you type
   - Filters both built-in and user recipes
   - Case-insensitive matching on recipe names
   - Automatic clearing on dialog open/close
6. ✅ ~~Add recipe duplication feature (save as copy)~~ **COMPLETED**
   - Duplicate button appears when editing an existing recipe
   - Creates a copy with new UUID and " (Copy)" suffix
   - Re-opens editor with the duplicate for immediate editing
   - Preserves all settings from the original recipe
7. ✅ ~~Add recipe validation feedback~~ **COMPLETED**
   - Real-time validation on input fields
   - Visual feedback with red borders and error messages
   - Validates numeric ranges (quality, PNG compression, gradient decay, etc.)
   - Prevents saving when validation errors exist
   - Clears errors automatically when values become valid
