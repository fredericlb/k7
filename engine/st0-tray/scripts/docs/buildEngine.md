# `npm run engine:build`

`build-engine.mjs` builds the native pieces and collects their artifacts into the monorepo's
`dist/`:

1. the **C++ engine** — CMake, through `engine/st0-engine/scripts/build.mjs` so "how the engine
   builds" is defined once. The preset comes from the host platform, or from
   `STUDIO_ENGINE_PRESET` when the build machine's toolchain is not the dev machine's — which is
   what a CI runner is (`docs/desktop-release.md`).
2. the **supervisor** — `engine/st0-supervisor`, its own CMake project, through
   `supervisorBuild.mjs`; `STUDIO_SUPERVISOR_PRESET` is its preset override;
3. the **tray app** — a Tauri release bundle: `nsis` on Windows, `deb` + `appimage` on Linux,
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
| `externalBin` sidecar | `st0-supervisor` — the supervisor the tray spawns |
| resource `onnxruntime/` | ONNX Runtime, which the supervisor loads for a stem cut |
| resource `faust-libs/` | the Faust standard libraries the engine compiles against |

Tauri copies `externalBin` into the bundle beside the tray executable
(`Contents/MacOS/` on macOS), which is what makes the `.app` self-contained — the tray finds the
supervisor there, and the supervisor finds the engine beside itself. Tauri resolves a sidecar as
`<name>-<triple>` **plus** the platform's executable extension, so on Windows the `.exe`-suffixed
file is the one it looks for and bundles.

No file service and no demo songs are in it: workspaces live on the server
(`packages/file-hub/docs/fileHub.md`), and what the machine needs of them the tunnel brings down.

### ONNX Runtime, as a resource and not beside the supervisor

The supervisor LOADS ONNX Runtime rather than linking it
(`engine/st0-supervisor/docs/supervisor.md`), and looks for it in the resources as well as beside
itself. It goes in the resources because a sidecar must be an executable Tauri names by triple, and
a shared library is not one. Its build copies the library beside the supervisor binary, and
`onnxRuntimeFiles` takes it from there — `libonnxruntime.*.dylib`, `.so.*`, or `onnxruntime.dll`
with `DirectML.dll` on Windows. Missing is a warning, not a failure: the app runs, and says it
cannot cut stems.

**macOS is not covered by signing.** `makeDmg` signs nothing, and a third-party dylib inside a
`.app` is a notarisation problem this repo has not solved.

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

Missing is **fatal**. Without it every Faust module fails to compile in the
installed app, one warning at a time, from a build that reported nothing wrong — the failure mode
this repo goes out of its way to avoid, and one `cmake --build` away from being impossible to
reproduce on the machine that made the bundle.

## The flags

### `--sidecar-only`

Skips the builds and just stages the sidecars. Any cargo/tauri command on the tray needs
them present (`tauri_build` validates `externalBin`), so this is the one-shot fix for a
plain `cargo check` / `tauri dev` workflow.

### `--dev`

Builds a **debug tray app that carries nothing**: the config override empties `externalBin`
and `resources`, so the tray finds no supervisor beside itself and takes its dev fallback — the
repo's `engine/st0-supervisor/build` — and that supervisor finds the engine in
`engine/st0-engine/build` the same way.

So editing engine or supervisor code needs no rebuild of this app. Fast to produce, not
distributable. Dev mode builds neither — it points at whatever is already built, which is what
makes the loop fast; `npm run dev` is what rebuilds them on save.

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

A dev build runs the supervisor and the engine from this checkout's build directories; a packaged
app carries its own copies of both.
