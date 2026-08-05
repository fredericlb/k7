# `npm run engine:build`

`build-engine.mjs` builds the native pieces and collects their artifacts into
`engine/capot/out/` — beside the script, not in l8: the tray is what ships them:

1. the **C++ engine** — CMake, with the preset chosen from the host platform. Delegated to
   the moteur's own `build:*` npm scripts so "how the engine builds" is defined once; Linux has
   no such script yet and keeps its preset in this file.
2. the **tray app** — a Tauri release bundle.

`out/` is gitignored (the repo-root `out/` rule matches at any depth).

## What the app carries

Everything needed to run with no repo and nothing on `PATH`:

| staged as | what |
|---|---|
| `externalBin` sidecar | `studio-moteur` — the audio engine |
| `externalBin` sidecar | `node` — runs the bundled JS processes |
| resource | the file service, bundled to one `.mjs` |
| resource | the supervisor, bundled to one `.mjs` |
| resource | the demo songs |

Tauri copies `externalBin` into the bundle beside the tray executable
(`Contents/MacOS/studio-moteur` on macOS), which is what makes the `.app` self-contained
— `engine.rs` prefers that copy over the repo's build directory. Tauri resolves a sidecar
as `<name>-<triple>` **plus** the platform's executable extension, so on Windows the
`.exe`-suffixed file is the one it looks for and bundles.

The demo songs matter for the same reason: a new workspace is seeded from them (see
`file-service/src/demos.ts`), and a double-clicked `.app` has no repo to copy them out of.
Without them every new workspace on an installed app opens empty. They are replaced
wholesale each build, so a demo deleted from the repo does not linger in the app, and the
per-machine junk a working checkout accumulates (caches, VCS, deps) is filtered out.

### Why Node is downloaded, not copied

The vendored `node` is pinned and fetched from nodejs.org rather than copied off the build
machine. A Homebrew `node` is a small shim that links Homebrew dylibs under
`/opt/homebrew/opt/...`, so it breaks the moment it leaves that machine; official builds
are self-contained. It stays on the repo's Node 22 line (`.nvmrc`).

### Bundling the two Node processes

Each is bundled with esbuild into a single `.mjs` the vendored Node runs directly — no
`tsx`, no `node_modules`. ESM output, so the ESM-only dependencies in the brain (Strudel)
need no interop shimming. Two things this needs:

- **`require` shim.** ESM output has no `require`, but CommonJS dependencies in this tree
  (Express and friends) call it at runtime. Without a real one the bundle dies on
  `Dynamic require of "path" is not supported`.
- **`fsevents` marked external.** An optional native module chokidar probes for and falls
  back from. It cannot be bundled and must not fail the build.
- **`onnxruntime-node` marked external *and staged*.** The other native module, and the
  contrast is the point: `fsevents` survives being external because a require that throws
  costs chokidar nothing. This one has no fallback, so external alone would only move the
  failure from build time to first use. `stageNodeModule` copies the package (and
  `onnxruntime-common`, which it requires) into `resources/node_modules/`, where the
  `.mjs` in `resources/` resolves it by ordinary Node lookup. Only the host's own
  `bin/napi-v3/<platform>/<arch>` tree is copied — ONNX Runtime ships one shared library
  per platform and the rest would be dead weight.

  **macOS is not covered.** `makeDmg` signs nothing, and a third-party `libonnxruntime.dylib`
  inside a `.app` is a notarisation problem this repo has never solved. Windows and Linux
  bundles carry it correctly; a macOS bundle needs signing work that does not exist yet.

esbuild is driven through its **JS API, not its CLI**: `run()` goes through `cmd.exe` on
Windows, which splits the spaces inside `--banner:js=...` into separate arguments, and
esbuild then errors with *"Must use outdir when there are multiple input files"*.

Both bundles are produced in the `--sidecar-only` path too, and must be:
`tauri.conf.json` lists both files as resources and Tauri **errors on a resource glob that
matches nothing**, so without them even `cargo check` and `tauri dev` fail.

## The flags

### `--sidecar-only`

Skips the builds and just stages the sidecars. Any cargo/tauri command on the tray needs
them present (`tauri_build` validates `externalBin`), so this is the one-shot fix for a
plain `cargo check` / `tauri dev` workflow.

### `--dev`

Builds a **debug tray app that carries nothing**: the config override empties `externalBin`
and `resources`, so the Rust finds no bundled engine, node or file service beside itself
and takes its dev fallbacks — the repo's `engine/moteur/build` for the engine, and `tsx` for the
file service. With no bundled file service the tray does not run one at all: it is started
separately with hot-reload by `npm run dev` (see `fileservice.rs`).

So editing engine or file-service code needs no rebuild of this app. Only `engine:build`
bundles and runs the file service. Fast to produce, not distributable. Dev mode never
rebuilds the engine either — it points at whatever is already in `engine/moteur/build`, which is
what makes the loop fast.

The build number the tray displays is local wall-clock `YYYYMMDD.HHMM`, stamped into the
binary via `build.rs` (`STUDIO_BUILD`), so it records when *this binary* was produced
rather than when it happens to run.

## Platform traps

### `--config` takes a file path, not inline JSON

`run()` spawns through `cmd.exe` on Windows (`shell: true`, for the `.cmd` shims), which
strips the JSON's double quotes and leaves Tauri parsing `{bundle:...}`. A file is
quoting-proof everywhere.

### Windows has no "app" bundle format

That is the macOS `.app` wrapper. Asking for it on Windows just builds the exe and produces
no `bundle/` directory at all — the debug exe *is* the dev artifact there, so bundling is
skipped and it is collected directly. For a release build the Windows deliverable is the
NSIS installer.

### Windows: use System32's `bsdtar` by path

It reads `.zip`. A bare `tar` can resolve to Git Bash's GNU tar depending on `PATH` order,
which does not.

### macOS: we build the `.dmg` ourselves

Tauri's `dmg` bundle target drives `hdiutil convert` through `bundle_dmg.sh`, which fails
on this machine with errno 35 (`EAGAIN`) out of `CUDIFFileAccess::updateHeader`. It fails
on a trivial 5 MB image too, so it is not about our bundle. `hdiutil create -srcfolder`
takes a different code path and works, so that is what `makeDmg` uses: stage the `.app`
next to an `/Applications` symlink (the drag-to-install affordance) and compress in one
step. What we give up is the styled Finder window — background art, icon positions — that
`bundle_dmg.sh`'s AppleScript adds.

`hdiutil` is intermittently flaky here in the same `EAGAIN` family (seen failing right
after another image was detached), so `makeDmg` retries rather than silently shipping
without a dmg; `-ov` makes a retry safe. EAGAIN means "try again *later*" — retrying
instantly just fails again (observed: three back-to-back failures, then success moments
later), so it backs off between attempts.

`CI=true` makes Tauri's `bundle_dmg.sh` skip the Finder/AppleScript styling, which needs an
interactive GUI session. A dmg failure is deliberately non-fatal: the bundler builds the
`.app` first and the `.dmg` second, so a dmg-only failure should not throw away a good
`.app`. We collect it, then exit non-zero.

## Still repo-dependent

The tray spawns the **file service** through the repo's `tsx` in a dev build, and a
packaged app carries its own bundle — but the engine itself is still built from this
checkout. Bundling a Node runtime for every platform is a separate, deferred step.
