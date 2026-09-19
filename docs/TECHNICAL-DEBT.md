# Technical Debt: Deferred Hardening & Refactoring

This document captures areas of known technical debt that were identified during the
June 2026 bug-fix review but deliberately deferred, because they involve design decisions
and behavioral trade-offs rather than straightforward fixes. Each section describes the
problem, why it matters, what could go wrong if left as-is, and a recommended path to
resolution.

Status:

| Item | Status |
|---|---|
| 1. Webview security configuration | **Resolved** (September 2026) |
| 2. Subprocess lifecycle & blocking commands | **Resolved** (September 2026) |
| 3. `main.js` modularization | Identified, analyzed, not yet implemented |

The problem analysis below is kept as a record of why each change was made. Where the
original recommendation turned out to be wrong or improvable, the resolution notes say so.

---

## 1. Webview Security Configuration (`tauri.conf.json`)

### Current state

Three settings in `desktop-app/src-tauri/tauri.conf.json` weaken the webview sandbox:

```json
"app": {
  "windows": [{ "devtools": true }],
  "security": {
    "csp": "... script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' ...",
    "assetProtocol": {
      "enable": true,
      "scope": ["**"]
    }
  }
}
```

| Setting | Problem |
|---|---|
| `assetProtocol.scope: ["**"]` | The webview can read **any file on the filesystem** via `asset://` URLs. |
| `'unsafe-inline'` in `script-src` | Any injected inline `<script>` or inline event handler executes, defeating most of the CSP's purpose. |
| `devtools: true` | DevTools ship enabled in production builds, giving anyone at the keyboard (or any injected script) a full JS console with `invoke()` access. |

### Why it matters

These three settings compound. The threat model for a desktop app like imgstax is
HTML injection through untrusted input. In imgstax, this input includes
imported recipe YAML files (names, descriptions), error strings echoed from
subprocesses, and file names from arbitrary directories the user opens.

The June 2026 fixes closed every known injection sink (all `innerHTML`
interpolations now go through `escapeHtml()`, and recipe YAML is serialized with
`jsyaml.dump` instead of string templates). However, defense-in-depth matters
because escaping at each insertion point is easy to overlook. One future
`innerHTML = \`...\${name}...\`` reintroduces the vector. If that happens today:

1. `'unsafe-inline'` lets the injected script run.
2. `scope: ["**"]` lets it read `~/.ssh/id_ed25519`, browser cookie stores,
   and keychain-adjacent files (anything the user can read) via `fetch('asset://...')`.
3. The script also has `window.__TAURI__.invoke`, which includes commands like
   `execute_postproc` (runs arbitrary recipe commands) and `delete_user_recipe`.

In other words, a single regressed escaping bug currently escalates to arbitrary
file read + command execution. With a tightened config it would be a cosmetic bug.

### Why it wasn't fixed inline

- **Asset scope:** the image preview feature uses `convertFileSrc()`
  (`dist/main.js`, `showPreview`) to display frames from whatever directory the
  user picks, including an external volume, a NAS mount, or
  anywhere else. A static narrowed scope (e.g. `$HOME/**`) would silently break
  previews for those users. The right fix is *dynamic* scoping, which is a code
  change, not a config change.
- **`'unsafe-inline'`:** removing it requires auditing `dist/index.html` for inline
  `style=`/`onerror=` usage (there is at least one inline `onerror` handler in the
  preview-image markup) and verifying Tauri's injected initialization scripts still
  run. `style-src 'unsafe-inline'` can stay (low risk); it's `script-src` that matters.

### Recommendations

In priority order:

1. **Disable devtools in release builds:**
   ```json
   "devtools": false
   ```
   Dev builds can re-enable it via `tauri.conf.dev.json` or the
   `devtools` Cargo feature. *(Effort: trivial.)*

2. **Replace the static `"**"` scope with runtime scope extension.** Set the static
   scope to `[]` (or at most `$APPDATA/**`), and when the user picks an input
   directory in `validate_directory` / the folder-open dialog, extend the scope from
   Rust:
   ```rust
   use tauri::Manager;
   // inside the command, after the user picks `dir`:
   app.asset_protocol_scope().allow_directory(&dir, true)?;
   ```
   This preserves previews from any location the user *explicitly chose*, while the
   webview can no longer read paths the user never pointed the app at. Note that
   scope grants are per-session, which is the desired behavior here.
   *(Effort: small; one `AppHandle` parameter added to the directory-selection
   command, plus the call above.)*

3. **Remove `'unsafe-inline'` from `script-src`.**
   - Move the inline `onerror` handler in the preview-image template into an
     `addEventListener('error', ...)` registered from `main.js`.
   - Audit `index.html` for any other inline `<script>` or `on*=` attributes
     (there should be none after the step above).
   - Tauri 2 auto-injects nonces/hashes for its own bootstrap scripts when a CSP is
     configured, so no extra work is needed for the framework itself.
   - Keep `'unsafe-inline'` in `style-src` if removing it proves noisy; inline
     *styles* are not a code-execution vector.
   *(Effort: small-medium; main cost is regression-testing every dialog.)*

4. **Optional, later:** prune the `invoke()` surface reachable from the webview.
   `tauri-plugin-fs` is initialized but granted zero permissions in
   `capabilities/default.json`. Remove the plugin and its Cargo dependency, since
   recipe import/export already goes through dedicated Rust commands.

### Resolution (September 2026)

Implemented, with two deviations from the recommendations above.

1. **Asset scope.** The static scope is now `[]` in `tauri.conf.json`, and
   `get_file_list` extends it at runtime for each directory the user opens:
   ```rust
   let canonical_dir = dir_path.canonicalize()?;
   app.asset_protocol_scope().allow_directory(&canonical_dir, false)?;
   ```
   Two corrections to the original plan:
   - The hook belongs in `get_file_list`, not `validate_directory`. `get_file_list`
     is the only command that hands image paths to the webview, and it is also on
     the queue-edit restore path (`main.js`, `editQueueItem`), which never calls
     `validate_directory`. Hooking validation alone would have broken previews for
     queued jobs.
   - The directory must be canonicalized first. `Scope::is_allowed` canonicalizes
     the requested path but `allow_directory` stores its argument verbatim, so an
     uncanonicalized `/tmp/frames` would never match a request for
     `/private/tmp/frames`.
   - `recursive` is `false`, not `true`: the listing is non-recursive, so the grant
     covers exactly the files the user can actually preview.

2. **`script-src`.** Now `'self'`, with `'unsafe-inline'` and the unused
   `'wasm-unsafe-eval'` both removed (nothing in the frontend uses WebAssembly).
   The one inline `onerror` handler, in the `previewImage` template in `main.js`,
   is now an `addEventListener('error', ...)`. Worth noting for future reference:
   Tauri only injects a CSP nonce when the HTML contains inline scripts or the
   nonce token, and `index.html` has neither, so `'unsafe-inline'` really was
   live rather than being neutered by a nonce.

3. **devtools: the original recommendation was wrong.** `"devtools": false` would
   have bought nothing and cost dev ergonomics. Every devtools path in
   `tauri-runtime-wry` is gated on `#[cfg(any(debug_assertions, feature = "devtools"))]`,
   the `devtools` Cargo feature is not enabled in this project, and `tauri build`
   compiles with `debug_assertions` off. Verified empirically: `nm` finds 52
   devtools symbols in the debug binary and **zero** in the release binary. Setting
   the flag to `false` would have disabled DevTools in `tauri dev` while changing
   nothing about release builds. The redundant `"devtools": true` line was simply
   deleted, which leaves the (already correct) default behavior in place.

4. **`tauri-plugin-fs` removed** from `Cargo.toml` and from the builder. The
   frontend only uses the `core`, `dialog`, `event` and `window` namespaces, and
   the plugin had no permissions granted in `capabilities/default.json` anyway.
   It remains in `Cargo.lock` as a transitive dependency of `tauri-plugin-dialog`,
   which cannot be avoided, but its commands are no longer registered.

Verified in a release build: the app launches and renders, the About, Preferences
and Queue dialogs all open, directory validation and format detection work, and
image previews (including the maximized overlay) render from a directory outside
any static scope, which they could not do if the runtime grant were not working.

### Acceptance criteria

- A `fetch('asset://localhost/' + encodeURIComponent('/etc/passwd'))` from the
  devtools console (dev build) fails with a scope error.
- Image previews still work from: home directory, external volume, network mount.
- `grep -n "onerror=\|onclick=\|<script>" dist/index.html` returns only the two
  bundled `<script src=...>` tags.
- App launches and all dialogs function with the new CSP (watch the console for
  CSP violation reports during a full manual pass).

---

## 2. Subprocess Lifecycle & Blocking Commands (`lib.rs`)

### Current state

Two related problems in `desktop-app/src-tauri/src/lib.rs`:

#### 2a. The stacking process is tracked by raw PID

```rust
static STACKING_PROCESS: once_cell::sync::Lazy<Arc<Mutex<Option<u32>>>> = ...;
```

- `start_stacking` spawns the Python process, stores `child.id()` in this global,
  and then reads stdout to completion.
- `cancel_stacking` (line ~1061) reads the PID and shells out to `kill -TERM <pid>`
  (Unix) or `taskkill /F /PID <pid>` (Windows).

This design has four defects:

1. **PID-reuse race.** Between the Python process exiting and the slot being
   cleared, the OS can recycle the PID. A late `cancel_stacking` then sends
   `SIGTERM` (or `taskkill /F`) to an unrelated process. Unlikely, but the failure
   mode (killing a random user process) is severe.
2. **No already-running guard.** A second `start_stacking` call overwrites the
   global slot, making the first job uncancellable. The first job's
   completion handler then clears the *second* job's PID. The frontend currently
   prevents double-starts via the disabled button, but the Rust layer should not
   rely on UI discipline.
3. **Child leak on read error.** In the stdout loop:
   ```rust
   let line = line.map_err(|e| format!("Failed to read output: {}", e))?;
   ```
   An early `?` return skips `child.wait()` (zombie process on Unix) and skips
   clearing `STACKING_PROCESS` (stale PID, see defect 1). The same pattern exists
   in `execute_postproc`.
4. **Shelling out to `kill`/`taskkill`** is slower and less reliable than the
   process handle the program already owns.

#### 2b. Synchronous commands run Python on the main thread

In Tauri 2, **non-`async` commands execute on the main thread**. These commands
each spawn a Python subprocess and block on `.output()`:

- `load_postproc_recipe` (line ~442)
- `save_postproc_recipe` (line ~473)
- `delete_postproc_recipe` (line ~497)
- `get_recipes` (line ~717)

In development mode each call pays full Python interpreter + imgstax import
startup (hundreds of milliseconds; worse on Windows), during which the **entire
UI freezes**, with no repaints or input. In production (bundled PyInstaller binary)
it's faster but still a synchronous process launch on the UI thread.

`list_postproc_recipes` (line ~416) already does this correctly with
`tauri::async_runtime::spawn_blocking`. Update the others to match.

Additionally, `start_stacking` and `execute_postproc` are `async fn` but perform
fully blocking work (spawn → read lines → wait) directly in the function body,
which ties up a tokio runtime worker for the duration of a stack (minutes). With
enough concurrent blocking commands this can starve the async runtime.

### Recommendations

All of these share one root fix: **hold the `Child`, not the PID, and do blocking
work on blocking threads.**

1. **Replace the global PID slot with a `Child` slot:**
   ```rust
   static STACKING_PROCESS: Mutex<Option<std::process::Child>> = Mutex::new(None);
   ```
   (With rust-version 1.77, `Mutex::new` is const, so the `once_cell::Lazy` and the
   `Arc` wrapper can both be dropped, and the `once_cell` dependency removed.)

2. **Guard against double-start.** At the top of `start_stacking`:
   ```rust
   let mut slot = STACKING_PROCESS.lock().map_err(...)?;
   if slot.is_some() {
       return Err("A stacking job is already running".into());
   }
   *slot = Some(child);
   drop(slot);
   ```

3. **Cancel via the handle.** `cancel_stacking` becomes:
   ```rust
   if let Some(child) = slot.as_mut() {
       child.kill().map_err(...)?;   // Kills this child without PID reuse
   }
   ```
   If graceful shutdown matters (letting Python finish writing the current frame),
   send SIGTERM via the `nix` crate on Unix using the held child's id *while still
   holding the lock* (the child cannot be reaped while the slot owns it, so the
   PID is guaranteed valid), then fall back to `kill()` after a timeout. On
   Windows, `Child::kill()` (TerminateProcess) is the standard approach.

4. **Make cleanup unconditional.** Wrap the read-loop body so that *every* exit
   path (success, read error, or JSON parse problem) reaches `child.wait()` and
   clears the slot. The simplest shape: move the loop into a closure/function,
   capture its `Result`, then do `let status = child.wait(); *slot = None;`
   before propagating the result. (A small scope-guard struct also works.)

5. **Move blocking work off the hot threads.** Extract the repeated
   spawn-and-parse pattern into one helper:
   ```rust
   async fn run_imgstax_json(extra_args: Vec<String>) -> Result<serde_json::Value, String> {
       tauri::async_runtime::spawn_blocking(move || {
           let (cmd, mut args) = get_imgstax_cmd()?;
           args.extend(extra_args);
           let mut command = Command::new(&cmd);
           command.args(&args);
           #[cfg(windows)]
           command.creation_flags(0x08000000);
           let output = command.output().map_err(|e| e.to_string())?;
           if !output.status.success() {
               return Err(String::from_utf8_lossy(&output.stderr).into_owned());
           }
           serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())
       })
       .await
       .map_err(|e| e.to_string())?
   }
   ```
   Then `get_recipes`, `load_postproc_recipe`, `save_postproc_recipe`,
   `delete_postproc_recipe`, and `list_postproc_recipes` each collapse to a few
   lines, become `async`, stop freezing the UI, and lose their copy-pasted
   `#[cfg(windows)]` blocks. For the two long-running streaming commands
   (`start_stacking`, `execute_postproc`), wrap the spawn/read/wait body in
   `spawn_blocking` as well; the line-by-line `window.emit(...)` calls work fine
   from a blocking thread because `Window` is `Send + Clone`.

6. **While in the area** (small, related cleanups):
   - `start_stacking` re-derives the binary path instead of calling
     `get_imgstax_cmd()`. Replace ~20 duplicated lines with one call.
   - Log non-JSON stdout lines in the stacking loop instead of silently
     discarding them (Python warnings currently vanish).
   - `list_user_recipes` aborts entirely if any one YAML file is corrupt (`?` on
     `serde_yaml::from_str`); skip-and-warn instead so one bad file doesn't hide
     every valid recipe.

### Suggested order of work

| Step | Scope | Risk |
|---|---|---|
| Helper + convert 5 JSON commands to `spawn_blocking` | ~80 lines net deletion | Low; same behavior on a blocking thread |
| `Child`-based slot + double-start guard + handle-based cancel | `start_stacking`, `cancel_stacking` | Medium; test cancel on macOS **and** Windows |
| Unconditional cleanup on all exit paths | stdout loops in 2 commands | Low |
| Drop `once_cell`, misc cleanups | Cargo.toml + small diffs | Trivial |

### Resolution (September 2026)

Implemented as recommended, with one refinement and one caveat.

- `STACKING_PROCESS` is now `static Mutex<Option<Child>>` (const `Mutex::new`);
  `once_cell` and the `Arc` wrapper are gone, and `once_cell` was dropped from
  `Cargo.toml`.
- `start_stacking` takes the lock **before** spawning and refuses a second job,
  so a rejected start never leaves a stray process behind.
- `cancel_stacking` signals the held handle while still holding the lock, so the
  PID cannot have been recycled. On Unix it sends `SIGTERM` via `libc` (preserving
  the previous signal, and leaving room for a future handler in the Python side),
  falling back to `Child::kill()` if that fails; elsewhere it calls `Child::kill()`
  directly. It deliberately leaves the slot populated: `start_stacking` owns the
  reaping, so clearing it here would leak a zombie.
- Both streaming read loops record a read error and `break` instead of `?`-ing out,
  so `child.wait()` and the slot clear are reached on every exit path.
- The five one-shot commands now share a `run_imgstax` / `run_imgstax_json` helper
  and all run under `spawn_blocking`. The doc's single JSON helper would not have
  covered `save_postproc_recipe` (returns a path) or `delete_postproc_recipe`
  (returns a bool), so the helper returns raw stdout with a thin JSON wrapper on
  top. `start_stacking` and `execute_postproc` are now thin `async` shells around
  blocking worker functions.
- `start_stacking` uses `get_imgstax_cmd()` instead of re-deriving the binary path;
  the now-unused `has_bundled_binary` was removed. Non-JSON stdout lines are logged
  rather than discarded. `list_user_recipes` skips and warns on a bad YAML file.

Two things the runtime test turned up that the original analysis missed:

- **The stacking child is not a leaf process.** The bundled binary is a
  PyInstaller one-file build, so the process we spawn is the bootloader and it
  re-execs the real interpreter as a child of its own. On Unix this does not
  matter (the bootloader forwards `SIGTERM`, verified: no survivors), but on
  Windows a plain `Child::kill()` is `TerminateProcess` against the bootloader
  alone and would have stranded the interpreter. The doc's recommendation to
  replace `taskkill /T` with `Child::kill()` would therefore have been a silent
  regression on Windows. `cancel_stacking` now keeps `taskkill /PID <id> /T /F`
  on Windows, taking the PID from the handle it owns while still holding the
  lock, which preserves both the tree kill and the PID-reuse protection, with
  `Child::kill()` as the fallback.
- **A separate zombie leak, unrelated to stacking.** `open_folder`,
  `play_notification_sound` and `speak_notification` all called
  `Command::spawn()` and never `wait()`, so every successful stack leaked one
  defunct `afplay` (or `say`) process for the lifetime of the app. This was
  pre-existing and is the same defect class as 2a.3. All three now go through a
  `spawn_and_reap` helper that hands the child to a detached thread to wait on.

Caveat:

- Error strings from the five converted commands are unified as
  `"imgstax error: ..."`, replacing the previous mix of `"Python error: ..."`,
  `"Failed to save recipe: ..."` and `"Failed to delete recipe: ..."`.

### Verification (release build, macOS, v2.4.1)

Driven against a 116-frame JPEG sequence:

| Check | Result |
|---|---|
| Cancel mid-stack | Stops the run (3 and 109 of 116 frames on two attempts) |
| Orphaned processes after cancel | None, including the PyInstaller grandchild |
| Zombies after cancel | None |
| New stack immediately after a cancel | Starts (proving the slot is cleared, since the double-start guard would otherwise reject it) |
| Full run to completion | 116 frames, no `stacking_error.log` |
| Zombies after a successful run | None, after the `spawn_and_reap` fix (one per run before it) |

Still owed: **the same pass on Windows**, where the `taskkill` tree-kill path and
the console-flag handling differ and cannot be exercised from macOS.

### Acceptance criteria

- Starting a stack while one is running returns a clean error to the GUI instead
  of orphaning the first job.
- Cancel works mid-stack on macOS and Windows; after cancel, `ps`/Task Manager
  shows no orphaned Python process and a new stack can start immediately.
- Opening the post-process dropdown or recipe list in dev mode no longer freezes
  the window (visually verifiable: spinner/hover states keep animating).
- `rg "once_cell" desktop-app/src-tauri/src desktop-app/src-tauri/Cargo.toml`
  returns nothing. (`Cargo.lock` still lists it: several Tauri crates depend on
  it transitively, so only the direct dependency can be removed.)

---

## 3. (Smaller) `main.js` Modularization

Noted for completeness: `dist/main.js` is ~3,800 lines in one file. It already has
clean section banners (Queue Management, Recipe Editor, Post-Processing, Dialogs,
Preferences), which map directly onto an ES-module split:

```
dist/js/
  helpers.js      (escapeHtml, intOr/floatOr/numOr, invokeWithTimeout, generateUUID)
  queue.js
  recipes.js      (editor + preview + import/export)
  postproc.js
  dialogs.js      (showMessageDialog, customConfirm, progress dialog)
  preferences.js
  main.js         (init, event wiring)
```

Tauri's webview supports `<script type="module">` with no build step. The split
requires converting cross-section function calls into imports and handling
the mutable globals (`inputDirPath`, `stackingQueue`,
`regularStackingStartTime`), which should move into a small shared `state.js` or
be passed explicitly. Best done *after* item 1's CSP work so the script tags only
change once.

No urgency; this is maintainability debt, not a correctness or security issue.
