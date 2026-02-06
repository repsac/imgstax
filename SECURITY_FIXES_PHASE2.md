# Phase 2 Security Fixes - HTML Escaping

## Changes Made

### 1. Added HTML Escape Utility Function
**Location:** `dist/main.js` (after invokeWithTimeout function)

```javascript
function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') {
        return unsafe;
    }
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
```

This function escapes HTML special characters to prevent XSS attacks.

---

### 2. Queue List Rendering (renderQueueList)
**Location:** `dist/main.js:534-570`

**Before:** User paths, prefixes, and error messages inserted directly into HTML
**After:** All user data escaped before insertion

Protected fields:
- `inputDirName` (from user paths)
- `outputDirName` (from user paths)
- `item.config.prefix` (user-provided prefix)
- `item.config.stacking` (stacking mode)
- `item.error` (error messages)
- `item.id` (queue item IDs)

---

### 3. File List Error Display (loadFileList catch block)
**Location:** `dist/main.js:1336`

**Before:**
```javascript
fileListEl.innerHTML = `<div class="file-list-empty">Error: ${error}</div>`;
```

**After:**
```javascript
fileListEl.innerHTML = `<div class="file-list-empty">Error: ${escapeHtml(String(error))}</div>`;
```

Prevents error messages from being interpreted as HTML.

---

### 4. File List Rendering (renderFileList)
**Location:** `dist/main.js:1396-1404`

**Before:** File paths and filenames inserted directly
**After:** Both escaped

Protected fields:
- `file.path` (file system paths)
- `file.filename` (user filenames)

---

### 5. Image Preview (previewImage)
**Location:** `dist/main.js:1430-1435`

**Before:**
```javascript
previewContentEl.innerHTML = `
    <img src="${imageUrl}" class="preview-image" alt="Preview"
         onerror="console.error('Image failed to load:', '${imageUrl}'); ...">
```

**After:**
```javascript
const safeImageUrl = escapeHtml(imageUrl);
previewContentEl.innerHTML = `
    <img src="${safeImageUrl}" class="preview-image" alt="Preview"
         onerror="this.parentElement.innerHTML='<div class=\\'preview-empty\\'>Failed to load image</div>'">
```

Changes:
- URL escaped before insertion
- Removed console.error from onerror (redundant and potential XSS vector)
- Simplified error handler

---

## Safe Usage Patterns Found

The following code patterns are already secure and were NOT changed:

1. **Recipe Selectors** (lines 2165-2186, 2491-2524)
   - Uses `textContent` instead of `innerHTML`
   - Uses `appendChild()` instead of string concatenation
   - ✅ Safe pattern - no XSS risk

2. **Clear Operations** (lines 526, 2488)
   - `element.innerHTML = ''` to clear content
   - ✅ Safe - no user data involved

3. **Static HTML** (lines 1392, 1457)
   - Hardcoded strings with no user data
   - ✅ Safe - no dynamic content

---

## Testing Checklist

Before considering this phase complete:

- [ ] Test queue system with unusual directory names (special chars, HTML tags)
- [ ] Test file browser with files containing special characters
- [ ] Test error messages display correctly
- [ ] Test image preview with unusual file paths
- [ ] Verify all queue operations still work (add, edit, remove, reorder)
- [ ] Check console for errors
- [ ] Test with paths containing: `<script>alert('xss')</script>`

---

## Risk Assessment

**Risk Level:** 🟢 LOW RISK

These changes are defensive additions that:
- Don't modify core functionality
- Add safety checks to existing code
- Use standard HTML escaping technique
- Don't introduce new dependencies
- Can be easily rolled back if issues arise

**Expected Behavior:** All functionality should work exactly as before, but now protected against XSS attacks through malicious file/directory names.

---

## What's Protected Now

✅ Malicious directory names can't execute scripts
✅ Filenames with HTML/JS can't be exploited
✅ Error messages are sanitized
✅ Queue item data is escaped
✅ Image URLs are sanitized (defense in depth)

---

## Next Steps (Phase 3)

After confirming these changes work:
1. Sync version numbers (tauri.conf.json)
2. Update app identifier
3. Consider tightening CSP
4. Test production build

After ALL phases complete:
- Address Python path issue (careful - broke before)
