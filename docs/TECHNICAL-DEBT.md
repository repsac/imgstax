# Technical Debt: Deferred Hardening & Refactoring

This document captures two areas of known technical debt that were identified during the
June 2026 bug-fix review but deliberately deferred, because both involve design decisions
and behavioral trade-offs rather than straightforward fixes. Each section describes the
problem, why it matters, what could go wrong if left as-is, and a recommended path to
resolution.

Status of each item: **identified, analyzed, not yet implemented.**

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
HTML injection through untrusted input — and imgstax *has* untrusted input paths:
imported recipe YAML files (names, descriptions), error strings echoed from
subprocesses, and file names from arbitrary directories the user opens.

The June 2026 fixes closed every known injection sink (all `innerHTML`
interpolations now go through `escapeHtml()`, and recipe YAML is serialized with
`jsyaml.dump` instead of string templates). However, defense-in-depth matters
precisely because sink-by-sink escaping is easy to regress — one future
`innerHTML = \`...\${name}...\`` reintroduces the vector. If that happens today:

1. `'unsafe-inline'` lets the injected script run.
2. `scope: ["**"]` lets it read `~/.ssh/id_ed25519`, browser cookie stores,
   keychain-adjacent files — anything the user can read — via `fetch('asset://...')`.
3. The script also has `window.__TAURI__.invoke`, which includes commands like
   `execute_postproc` (runs arbitrary recipe commands) and `delete_user_recipe`.

In other words, a single regressed escaping bug currently escalates to arbitrary
file read + command execution. With a tightened config it would be a cosmetic bug.

### Why it wasn't fixed inline

- **Asset scope:** the image preview feature uses `convertFileSrc()`
  (`dist/main.js`, `showPreview`) to display frames from whatever directory the
  user picks — which may legitimately be on an external volume, a NAS mount, or
  anywhere else. A static narrowed scope (e.g. `$HOME/**`) would silently break
  previews for those users. The right fix is *dynamic* scoping, which is a code
  change, not a config change.
- **`'unsafe-inline'`:** removing it requires auditing `dist/index.html` for inline
  `style=`/`onerror=` usage (there is at least one inline `onerror` handler in the
  preview-image markup) and verifying Tauri's injected initialization scripts still
  run. `style-src 'unsafe-inline'` can stay (low risk); it's `script-src` that matters.

### Recommendations

In priority order:

1. **Disable devtools in release builds** — zero-risk, one line:
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
   *(Effort: small — one `AppHandle` parameter added to the directory-selection
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
   `capabilities/default.json` — remove the plugin and its Cargo dependency, since
   recipe import/export already goes through dedicated Rust commands.

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
   global slot, making the first job uncancellable — and the first job's
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
UI freezes** — no repaints, no input. In production (bundled PyInstaller binary)
it's faster but still a synchronous process launch on the UI thread.

`list_postproc_recipes` (line ~416) already does this correctly with
`tauri::async_runtime::spawn_blocking` — the fix is to make the others match.

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
   (With rust-version 1.77, `Mutex::new` is const — the `once_cell::Lazy` and the
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
       child.kill().map_err(...)?;   // no PID reuse possible — kills *this* child
   }
   ```
   If graceful shutdown matters (letting Python finish writing the current frame),
   send SIGTERM via the `nix` crate on Unix using the held child's id *while still
   holding the lock* (the child cannot be reaped while the slot owns it, so the
   PID is guaranteed valid), then fall back to `kill()` after a timeout. On
   Windows, `Child::kill()` (TerminateProcess) is the standard approach.

4. **Make cleanup unconditional.** Wrap the read-loop body so that *every* exit
   path — success, read error, JSON parse problem — reaches `child.wait()` and
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
     `get_imgstax_cmd()` — replace ~20 duplicated lines with one call.
   - Log non-JSON stdout lines in the stacking loop instead of silently
     discarding them (Python warnings currently vanish).
   - `list_user_recipes` aborts entirely if any one YAML file is corrupt (`?` on
     `serde_yaml::from_str`); skip-and-warn instead so one bad file doesn't hide
     every valid recipe.

### Suggested order of work

| Step | Scope | Risk |
|---|---|---|
| Helper + convert 5 JSON commands to `spawn_blocking` | ~80 lines net deletion | Low — behavior identical, just off-thread |
| `Child`-based slot + double-start guard + handle-based cancel | `start_stacking`, `cancel_stacking` | Medium — test cancel on macOS **and** Windows |
| Unconditional cleanup on all exit paths | stdout loops in 2 commands | Low |
| Drop `once_cell`, misc cleanups | Cargo.toml + small diffs | Trivial |

### Acceptance criteria

- Starting a stack while one is running returns a clean error to the GUI instead
  of orphaning the first job.
- Cancel works mid-stack on macOS and Windows; after cancel, `ps`/Task Manager
  shows no orphaned Python process and a new stack can start immediately.
- Opening the post-process dropdown or recipe list in dev mode no longer freezes
  the window (visually verifiable: spinner/hover states keep animating).
- `rg "once_cell" desktop-app/src-tauri` returns nothing.

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

Tauri's webview supports `<script type="module">` with no build step — the only
constraints are converting cross-section function calls into imports and being
careful with the handful of mutable globals (`inputDirPath`, `stackingQueue`,
`regularStackingStartTime`), which should move into a small shared `state.js` or
be passed explicitly. Best done *after* item 1's CSP work so the script tags only
change once.

No urgency; this is maintainability debt, not a correctness or security issue.
