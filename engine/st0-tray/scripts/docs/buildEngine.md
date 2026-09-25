# `npm run engine:build`

`build-engine.mjs` builds the native pieces and collects their artifacts into the monorepo's
`dist/`:

1. the **C++ engine** — CMake, through `engine/st0-engine/scripts/build.mjs` so "how the engine
   builds" is defined once. The preset comes from the host platform, or from
   `STUDIO_ENGINE_PRESET` when the build machine's toolchain is not the dev machine's — which is
   what a CI runner is (`docs/desktop-release.md`).
2. the **tray app** — a Tauri release bundle: `nsis` on Windows, `deb` + `appimage` on Linux,
   and on macOS the `app` wrapper `tauri.conf.json` names, which `makeDmg` then packages.

## `dist/` is the repo's, not the tray's

The scripts live here because the tray is what ships the native pieces, but the output does
not: `dist/` sits at the monorepo root, one place to look for anything this repo produces,
and gitignored by the rule that was already there for every package's `dist/`. `buildTools.mjs`
holds the one definition of where it is.

Its **top level is deliverables only**, and the directories beside them are working space —
`dev/`, `portable/`, `release/`, named once in `buildTools.mjs` as `WORK_DIRS`. Two things read
that list rather than repeating it: a release build wipes the deliverables and leaves the
working dirs alone, and `package-release.mjs` archives the deliverables and leaves the working
dirs out. A list written twice is how a 400 MB staging tree ends up inside a release archive.

`package-release.mjs` beside this script turns those deliverables into the ONE archive a
platform ships, into `dist/release/` — `npm run engine:package`. It is the release deliverable,
and `docs/desktop-release.md` is its page.

`build-portable.mjs` is the other Windows deliverable — `npm run engine:portable`, one
self-extracting `.exe` instead of an installer, staged through this script so both carry the
same thing. [buildPortable.md](buildPortable.md) is its page.

## What the app carries

Everything needed to run with no repo and nothing on `PATH`:

| staged as | what |
|---|---|
| `externalBin` sidecar | `st0-engine` — the audio engine |
| `externalBin` sidecar | `node` — runs the supervisor |
| resource | the supervisor, bundled to one `.mjs` |

Tauri copies `externalBin` into the bundle beside the tray executable
(`Contents/MacOS/st0-engine` on macOS), which is what makes the `.app` self-contained
— the supervisor prefers that copy over the repo's build directory. Tauri resolves a sidecar
as `<name>-<triple>` **plus** the platform's executable extension, so on Windows the
`.exe`-suffixed file is the one it looks for and bundles.

No file service and no demo songs are in it: workspaces live on the server
(`packages/file-hub/docs/fileHub.md`), and what the machine needs of them the tunnel brings down.
Without them every new workspace on an installed app opens empty. They are replaced
wholesale each build, so a demo deleted from the repo does not linger in the app, and the
per-machine junk a working checkout accumulates (caches, VCS, deps) is filtered out.

### Why Node is downloaded, not copied

The vendored `node` is pinned and fetched from nodejs.org rather than copied off the build
machine. A Homebrew `node` is a small shim that links Homebrew dylibs under
`/opt/homebrew/opt/...`, so it breaks the moment it leaves that machine; official builds
are self-contained. It stays on the repo's Node 22 line (`.nvmrc`).

The archive is **checksummed before it is trusted**. This binary is what runs
`engine-host.mjs` inside the signed app, so a substituted archive is
arbitrary code shipped under our signature. `verifyNodeArchive` is what compares it. The C++
side pins its ASIO SDK by digest (`engine/st0-engine/CMakeLists.txt`); this is the same rule for
the other downloaded dependency.

It is checked against the release's own `SHASUMS256.txt` rather than a digest pinned in the
script, because a table would need an entry per platform and arch and would go stale at every Node
bump — the failure mode being a build that silently stops verifying. It catches a truncated,
corrupted or swapped archive; it does not, on its own, defend against nodejs.org itself being
compromised. A failing archive is **deleted**, not merely refused: leaving it means the next run
finds it "cached" and trusts it.

### The Faust standard libraries

`import("stdfaust.lib")` is resolved when the ENGINE compiles a module — at runtime, on the
musician's machine — so `libraries/` has to travel with the app. Its only other copy is
`_deps/faust-src`, which is a build directory and does not ship.

`stageFaustLibs` finds it by walking the build presets rather than naming one: which preset was
used is the caller's business, and `findEngineBinary` already answers the same question the same
way. The NEWEST wins, for the same reason it does there — a stale `libraries/` from a preset nobody
builds any more would ship a different Faust than the engine beside it. Only the `.lib` files are
copied; the submodule also carries its own docs, tests and CI config, none of which the compiler
reads.

Missing is **fatal**, following `vendorNode`. Without it every Faust module fails to compile in the
installed app, one warning at a time, from a build that reported nothing wrong — the failure mode
this repo goes out of its way to avoid, and one `cmake --build` away from being impossible to
reproduce on the machine that made the bundle.

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
and `resources`, so the Rust finds no bundled engine or node beside itself and takes its dev
fallbacks — the repo's `engine/st0-engine/build` for the engine, and `tsx` for the supervisor.

So editing engine or supervisor code needs no rebuild of this app. Fast to produce, not
distributable. Dev mode never
rebuilds the engine either — it points at whatever is already in `engine/st0-engine/build`, which is
what makes the loop fast.

The build number the tray displays is local wall-clock `YYYYMMDD.HHMM`, stamped into the
binary via `build.rs` (`STUDIO_BUILD`), so it records when *this binary* was produced
rather than when it happens to run.

## Platform traps

### `--config` takes a file path, not inline JSON

`run()` spawns through `cmd.exe` on Windows (`shell: true`, for the `.cmd` shims), which
strips the JSON's double quotes and leaves Tauri parsing `{bundle:...}`. A file is
quoting-proof everywhere.

### Only macOS has an "app" bundle format

That is the `.app` wrapper. Asking for it on Windows or Linux just builds the executable and
produces no `bundle/` directory at all — the debug executable *is* the dev artifact there, so
`--dev` passes `--no-bundle` and collects it directly. A release build names its own targets
instead: the NSIS installer on Windows, `.deb` + `.AppImage` on Linux.

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

The tray spawns the **supervisor** through the repo's `tsx` in a dev build, and a packaged app
carries its own bundle — but the engine itself is still built from this checkout.
