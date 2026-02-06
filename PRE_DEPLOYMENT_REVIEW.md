# Pre-Deployment Security & Portability Review

## CRITICAL ISSUES (Must Fix)

### 1. Hard-coded Python Path
**Location:** `desktop-app/src-tauri/src/lib.rs:37`
```rust
fn get_python_path() -> String {
    "/Users/edcaspersen/.pyenv/versions/3.12.8/bin/python3".to_string()
}
```
**Problem:** This path only exists on your development machine
**Impact:** App will fail on any other machine in development mode
**Risk Level:** 🔴 HIGH - Breaks app on other machines

**Recommendation:** Use `which python3` or check PATH for python3
**Previous Issue:** This was attempted before and broke - need careful approach

---

### 2. Development Path Dependencies
**Location:** Multiple places in `lib.rs` using `CARGO_MANIFEST_DIR`
- Line 232: `.current_dir(env!("CARGO_MANIFEST_DIR").to_string() + "/../..")`
- Line 312: Same pattern
- Line 518: Same pattern
- Line 587: Same pattern

**Problem:** These assume development directory structure
**Impact:** Works in dev, unclear if it works in production build
**Risk Level:** 🟡 MEDIUM - May work in production but needs verification

**Recommendation:** Use Tauri's resource path APIs for production
**Note:** This may already work correctly - needs testing

---

## MEDIUM PRIORITY ISSUES

### 3. Potential XSS via innerHTML
**Location:** `dist/main.js` - Multiple instances
- Line 520: Queue list rendering with user paths
- Line 1314: Error message with user input
- Line 1374: File list rendering
- Line 1406: Image preview with file paths

**Problem:** User-provided paths inserted directly into HTML
**Impact:** If paths contain `<script>` tags or HTML, could execute
**Risk Level:** 🟡 MEDIUM - Requires malicious file paths

**Example:**
```javascript
queueList.innerHTML = stackingQueue.map((item, index) => {
    const inputDirName = item.config.input_path.split(/[\\/]/).pop() || item.config.input_path;
    return `<strong>${inputDirName}</strong>`; // Unescaped!
});
```

**Recommendation:** HTML-escape all user data before inserting
**Note:** CSP provides some protection but not complete

---

### 4. CSP Allows unsafe-inline
**Location:** `desktop-app/src-tauri/tauri.conf.json:23`
```json
"csp": "... script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; ..."
```

**Problem:** `unsafe-inline` allows inline scripts
**Impact:** Weakens XSS protection
**Risk Level:** 🟡 MEDIUM - Defense in depth issue

**Recommendation:** Remove unsafe-inline if possible, use nonces
**Note:** May be required for current architecture

---

## LOW PRIORITY ISSUES

### 5. Missing Input Validation
**Location:** `desktop-app/src-tauri/src/lib.rs` - Command functions

**Current Good Practices:**
- ✅ Recipe ID validation (lines 15-31) - prevents path traversal
- ✅ Path validation exists in some places

**Missing:**
- File path length validation
- Character set validation for paths
- Size limits on directory operations

**Risk Level:** 🟢 LOW - Mostly mitigated by OS

**Recommendation:** Add additional validation for completeness

---

### 6. Configuration Issues

**Location:** `desktop-app/src-tauri/tauri.conf.json`
- Line 4: `"version": "0.1.0"` - Doesn't match package versions (2.1.0)
- Line 5: `"identifier": "com.tauri.dev"` - Generic identifier

**Problem:** Inconsistent versioning, generic app identifier
**Impact:** App store submissions may fail, version confusion
**Risk Level:** 🟢 LOW - Cosmetic/organizational

**Recommendation:** Sync versions, use proper identifier

---

## RECOMMENDATIONS PRIORITY ORDER

### Phase 1: Critical Path Fix (Test Carefully!)
1. **Fix Python path discovery** - Use system PATH lookup with fallbacks
   - This broke before, so implement with explicit testing
   - Add error messages to help debug issues

### Phase 2: Security Hardening
2. **Add HTML escaping utility** - Prevent XSS
3. **Test production build** - Verify CARGO_MANIFEST_DIR paths work

### Phase 3: Polish
4. **Sync version numbers** - Update tauri.conf.json
5. **Update app identifier** - Use proper com.yourdomain.imgstax
6. **Tighten CSP** - Remove unsafe-inline if possible

---

## TESTING CHECKLIST

Before deploying any fixes:
- [ ] Test on clean machine (not your dev machine)
- [ ] Test with unusual file paths (spaces, special chars)
- [ ] Test production build (not just dev mode)
- [ ] Test all major features (stacking, queue, recipes)
- [ ] Check console for errors
- [ ] Verify Python module imports work

---

## INCREMENTAL FIX APPROACH

**DO NOT FIX ALL AT ONCE**

1. Create test branch for each fix
2. Fix one issue
3. Test thoroughly
4. Commit if working, rollback if broken
5. Move to next issue

This prevents the "everything broke" scenario from before.
