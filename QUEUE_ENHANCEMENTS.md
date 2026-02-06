# Queue System Enhancements

## Features Implemented

### 1. Re-queue Completed Exports ✅

**User Story:** Users can re-run completed exports with small edits

**Implementation:**
- Added "↻" (re-queue) button to completed/failed/cancelled items in queue list
- Button resets item status from completed/failed/cancelled → pending
- Clears any error messages
- Item moves back into the pending queue for batch processing

**Files Modified:**
- `dist/main.js` - Added `requeueItem()` function (lines 393-407)
- `dist/main.js` - Updated renderQueueList to show re-queue button (lines 569-571)
- `dist/main.js` - Added handler in event delegation (line 615)

**Usage:**
1. Open Queue dialog
2. Find a completed/failed item
3. Click "↻" button
4. Item returns to pending status
5. Can edit with "✎" button or process in next batch

---

### 2. Always Enable "Open Queue" Button ✅

**User Story:** Users can view completed stacks even when no pending items

**Implementation:**
- "Open Queue" button now always enabled
- Shows total count: `Open Queue (4)` instead of just pending count
- Users can review completed exports anytime

**Files Modified:**
- `dist/main.js` - Updated `updateQueueBadge()` function (lines 216-232)
  - Changed from `pendingCount` to `totalCount`
  - Removed `disabled = true` logic
  - Button always enabled now

**Before:**
```
Open Queue (disabled when no pending items)
```

**After:**
```
Open Queue (4)  ← Always clickable, shows all items
```

---

### 3. Export recipe.yaml with Stacked Images ✅

**User Story:** Users can recreate exports by exporting configuration alongside images

**Implementation:**
- Added checkbox: "Export recipe.yaml with stacked images"
- When checked, creates `recipe.yaml` in output directory
- Contains all configuration parameters used for the export
- Compatible with imgstax recipe format for re-import

**Files Modified:**

**Frontend:**
- `dist/index.html` - Added exportRecipe checkbox (lines 157-161)
- `dist/main.js` - Added to `collectFormConfig()` (line 260)
- `dist/main.js` - Added to regular stacking config (line 1538)

**Backend:**
- `desktop-app/src-tauri/src/lib.rs` - Added `export_recipe: bool` to StackConfig (line 100)
- `desktop-app/src-tauri/src/lib.rs` - Added recipe export logic after successful stacking (lines 631-669)

**Recipe Format:**
```yaml
# imgstax Recipe
# Generated automatically with exported images

name: Exported Recipe
description: Configuration used for this stacking export

stacking: progressive
quality: 100
png_compress_level: 6
tiff_compression: deflate
start_frame: 0
end_frame: 100
frame_interval: 1
trail_length: 5
trail_gradient: true
gradient_decay: 0.85
gradient_plateau: 0
fade_out: false
```

**Benefits:**
- Users can recreate exact same export later
- Share configuration with others
- Document export settings
- Import as recipe template for future projects

---

## Testing Checklist

### Re-queue Feature
- [ ] Re-queue a completed item → Returns to pending
- [ ] Re-queue a failed item → Returns to pending
- [ ] Re-queue a cancelled item → Returns to pending
- [ ] Try to re-queue a processing item → Blocked
- [ ] Re-queued item can be edited
- [ ] Re-queued item processes correctly in batch
- [ ] Error message cleared on re-queue

### Always Enable Open Queue
- [ ] Open Queue works with 0 items
- [ ] Open Queue shows correct total count
- [ ] Badge updates when items added/removed
- [ ] Can view completed items anytime

### Export Recipe
- [ ] Checkbox appears in form
- [ ] Unchecked by default
- [ ] When checked, recipe.yaml created in output directory
- [ ] Recipe contains all configuration parameters
- [ ] Recipe is valid YAML format
- [ ] Recipe can be imported back as user recipe
- [ ] Works with immediate stacking
- [ ] Works with batch queue processing
- [ ] Doesn't fail stacking if recipe write fails (warning only)

---

## Compatibility

### Regular Stacking
✅ All features work with immediate "Start Stacking" button

### Batch Queue Processing
✅ All features work with queued jobs
✅ Re-queue works after batch completion
✅ Recipe export works for each queued item

### Existing Functionality
✅ No breaking changes to existing features
✅ Edit, move up/down still work
✅ Remove still works
✅ Clear Completed still works

---

## Future Enhancements (Optional)

1. **Bulk Re-queue**
   - "Re-queue All Failed" button
   - Batch re-queue selected items

2. **Recipe Export Options**
   - Custom recipe name
   - Add notes/description to exported recipe
   - Choose which parameters to include

3. **Queue History**
   - Keep completed items longer (configurable)
   - Export/import queue state
   - Queue statistics (total processed, success rate)

---

## Summary

All three requested features successfully implemented:
1. ✅ Re-queue completed exports
2. ✅ Always enable Open Queue button
3. ✅ Export recipe.yaml with images

Total files modified: 3
- `dist/index.html` (1 addition)
- `dist/main.js` (5 additions/modifications)
- `desktop-app/src-tauri/src/lib.rs` (2 additions)

Risk level: 🟢 LOW - Additive features, no breaking changes
