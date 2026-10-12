# `npm run engine:build`

`build-engine.mjs` builds the native pieces and collects their artifacts into the monorepo's
`dist/`:

1. the **C++ engine** — CMake, through `engine/st0-engine/scripts/build.mjs` so "how the engine
   builds" is defined once. The preset comes from the host platform, or from
   `STUDIO_ENGINE_PRESET` when the build machine's toolchain is not the dev machine's — which is
   what a CI runner is (`docs/desktop-release.md`).
2. the **supervisor** — `engine/st0-supervisor`, its own CMake project, through
   `supervisorBuild.mjs`; `STUDIO_SUPERVISOR_PRESET` is its preset override;
3. the **tray app** — `engine/st0-tray` itself, packaged by electron-builder: NSIS on Windows, `.deb` +
   `.AppImage` on Linux, and on macOS the `.app`, which `makeDmg` then packages.



## `dist/` is the repo's, not the tray's

The scripts live here because the tray is what ships the native pieces, but the output does
not: `dist/` sits at the monorepo root, one place to look for anything this repo produces,
and gitignored by the rule that was already there for every package's `dist/`. `buildTools.mjs`
holds the one definition of where it is.

Its **top level is deliverables only**, and the directories beside them are working space —
`portable/`, `release/`, named once in `buildTools.mjs` as `WORK_DIRS`. Two things read
that list rather than repeating it: a release build wipes the deliverables and leaves the
working dirs alone, and `package-release.mjs` archives the deliverables and leaves the working
dirs out. A list written twice is how a 400 MB staging tree ends up inside a release archive.

`package-release.mjs` beside this script turns those deliverables into the ONE archive a
platform ships, into `dist/release/` — `npm run engine:package`. It is the release deliverable,
and `docs/desktop-release.md` is its page.

`build-portable.mjs` is the other Windows deliverable — `npm run engine:portable`, one
self-extracting `.exe` instead of an installer, staged by the same `stage.mjs` so both carry the
same thing. [buildPortable.md](buildPortable.md) is its page.

## What the app carries

Everything needed to run with no repo and nothing on `PATH`, all in the app's `Resources/bin/`
(`engine/st0-tray/scripts/stage.mjs`, through `packages/supervisor-host/scripts/stageEngine.mjs`,
which the standalone app shares):

| file | what |
|---|---|
| `st0-engine` | the audio engine |
| `st0-supervisor` | the supervisor the tray spawns |
| ONNX Runtime, beside it | the library the supervisor loads for a stem cut |
| `faust-libs/` | the Faust standard libraries the engine compiles against |

One flat folder because each binary looks for the next beside itself: the supervisor for the
engine and ONNX Runtime, the engine for `faust-libs/`.

No file service and no demo songs are in it: workspaces live on the server
(`packages/file-hub/docs/fileHub.md`), and what the machine needs of them the tunnel brings down.

### ONNX Runtime, beside the supervisor

The supervisor LOADS ONNX Runtime rather than linking it
(`engine/st0-supervisor/docs/supervisor.md`), and looks for it beside itself first. Its build
copies the library beside the supervisor binary, and the staging takes it from there — `libonnxruntime.*.dylib`, `.so.*`, or `onnxruntime.dll`
with `DirectML.dll` on Windows. Missing is a warning, not a failure: the app runs, and says it
cannot cut stems.

**macOS is not covered by signing.** Nothing in the release signs, and a third-party dylib inside a
`.app` is a notarisation problem this repo has not solved.

### The Faust standard libraries

`import("stdfaust.lib")` is resolved when the ENGINE compiles a module — at runtime, on the
musician's machine — so `libraries/` has to travel with the app. Its only other copy is
the folder the engine's CMake fetched, which is not part of any package.

The staging finds it by walking the build presets rather than naming one: which preset was
used is the caller's business, and `findEngineBinary` already answers the same question the same
way. Each preset's `CMakeCache.txt` NAMES the folder (`STUDIO_FAUST_LIBS`) rather than the script
guessing `_deps/faust-src`: with `$STUDIO_FETCHCONTENT_DIR` set, as CI sets it, the sources live
outside the build tree altogether. The NEWEST wins, for the same reason it does there — a stale `libraries/` from a preset nobody
builds would ship a different Faust than the engine beside it. Only the `.lib` files are
copied; the submodule also carries its own docs, tests and CI config, none of which the compiler
reads.

Missing is **fatal**. Without it every Faust module fails to compile in the
installed app, one warning at a time, from a build that reported nothing wrong — the failure mode
this repo goes out of its way to avoid, and one `cmake --build` away from being impossible to
reproduce on the machine that made the bundle.

## The build stamp

The build number the tray displays is local wall-clock `YYYYMMDD.HHMM`, baked into its bundle by
`build-main.mjs` (`STUDIO_BUILD`), so it records when *this build* was produced rather than when it
happens to run. A bundle made without one says `dev`.

## Platform traps

### macOS: we build the `.dmg` ourselves

electron-builder is asked for the `.app` alone, and `makeDmg` makes the image. `hdiutil convert`,
the path a bundler's dmg target drives, fails on this machine with errno 35 (`EAGAIN`) out of
`CUDIFFileAccess::updateHeader` — on a trivial 5 MB image too, so it is not about our bundle.
`hdiutil create -srcfolder` takes a different code path and works, so that is what `makeDmg`
uses: stage the `.app` next to an `/Applications` symlink (the drag-to-install affordance) and
compress in one step. What we give up is a styled Finder window — background art, icon positions.

`hdiutil` is intermittently flaky here in the same `EAGAIN` family (seen failing right
after another image was detached), so `makeDmg` retries rather than silently shipping
without a dmg; `-ov` makes a retry safe. EAGAIN means "try again *later*" — retrying
instantly just fails again (observed: three back-to-back failures, then success moments
later), so it backs off between attempts.

A dmg failure is deliberately non-fatal: the `.app` is already collected, and an archive holding
it is still a release. A packaging failure is fatal, after collecting whatever it did produce.

## Still repo-dependent

A dev build runs the supervisor and the engine from this checkout's build directories; a packaged
app carries its own copies of both.
