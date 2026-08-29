# `npm run engine:build`

Three files, and the split is what keeps the staging single-definition while two packagers
use it — and each file under the 500-line rule:

| file | what it is |
|---|---|
| `stage.mjs` | everything the app CARRIES: the vendored node, the two esbuilt `.mjs`, the demos, the Faust libraries, onnxruntime. Plus `run`, `findEngineBinary` and the build number. No packager knowledge. |
| `build-app.mjs` | `npm run app:pack` — the C++ engine, `stageAll` into `staging/`, then electron-builder. |
| `make-dmg.mjs` | a macOS dmg by hand, for when electron-builder's own target hits hdiutil's EAGAIN. A fallback, not the path. |

Both collect into `apps/studio-desktop/out/` — beside the scripts, not in st0: the desktop app is
what ships them. The **C++ engine** is CMake with the preset chosen from the host platform,
delegated to the moteur's own `build:*` npm scripts so "how the engine builds" is defined
once; Linux has no such script yet and keeps its preset here.

## What electron-builder needs told twice

`node_modules` gets an `extraResources` entry **of its own**, beside the one that copies
`staging/` whole. A directory copy silently drops that name, so without the second entry
onnxruntime-node vanishes from the bundle while everything else arrives — and nothing fails
until the first stem split. The same shape of bug as the `napi-v3` pin below, found the same
way: by listing `resources/` after a real pack rather than trusting the config.

And the `electron` devDependency is pinned EXACTLY, not ranged: electron-builder downloads
platform binaries for one release and refuses to guess from a range.

## The flat resources rule

`stageAll` puts node, `studio-moteur`, `engine-host.mjs`, `file-service.mjs`, `songs/`,
`faust-libs/` and `node_modules/` in **one flat directory**, which electron-builder copies in
whole. That is not tidiness: `engine-host`'s `bundle.ts` derives its resource dir from
`process.execPath`, and for the supervisor that is the **vendored node** — so everything it
looks for has to be node's sibling. Nest anything and `vendoredNode()` returns null,
`fileServiceRuntime()` returns null, and `fileServiceProcess` reports `unavailable` — which
means "dev, the watcher owns 8770" and shows as a working engine with a permanently red icon
and "file service down", with nothing in the log to say why. Every developer machine works,
because there the watcher really is there.

`out/` is gitignored (the repo-root `out/` rule matches at any depth).

## What the app carries

Everything needed to run with no repo and nothing on `PATH`:

| staged as | what |
|---|---|
| staged resource | `studio-moteur` — the audio engine |
| staged resource | `node` — runs the bundled JS processes |
| resource | the file service, bundled to one `.mjs` |
| resource | the supervisor, bundled to one `.mjs` |
| resource | the demo songs |

`stageAll` puts them all in one flat directory, which electron-builder copies into
`resources/` whole — that is what makes the app self-contained, and the supervisor prefers
that copy over the repo's build directory. No `<name>-<triple>` naming any more: that was
Tauri's sidecar convention, and it took the only need for `rustc` with it.

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

The archive is **checksummed before it is trusted**. This binary is what runs
`engine-host.mjs` and `file-service.mjs` inside the signed app, so a substituted archive is
arbitrary code shipped under our signature. `verifyNodeArchive` is what compares it. The C++
side pins its ASIO SDK by digest (`engine/moteur/CMakeLists.txt`); this is the same rule for
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
  `.mjs` beside it resolves it by ordinary Node lookup. Only the host's own
  `bin/napi-v<n>/<platform>/<arch>` tree is copied — ONNX Runtime ships one shared library
  per platform and the rest would be dead weight.

  The Node-API generation is **discovered, never spelled**. It was pinned to `napi-v3` while
  the installed package had moved to `napi-v6`, so the prune matched nothing to keep and
  excluded *every* binding: the bundle carried the JS with no native module at all. Nothing
  fails until the first stem split, and then it says "onnxruntime-node is not installed — run
  `npm install` at the repo root", which means nothing on a musician's machine.
  `src/staging.test.ts` is the regression test.

  **macOS is not covered.** Nothing here signs, and a third-party `libonnxruntime.dylib`
  inside a `.app` is a notarisation problem this repo has never solved. Windows and Linux
  bundles carry it correctly; a macOS bundle needs signing work that does not exist yet.

esbuild is driven through its **JS API, not its CLI**: `run()` goes through `cmd.exe` on
Windows, which splits the spaces inside `--banner:js=...` into separate arguments, and
esbuild then errors with *"Must use outdir when there are multiple input files"*.

## The flag that went

There used to be a `--sidecar-only`, and it was mandatory before any build command:
`tauri.conf.json` listed the two `.mjs` files as resources and Tauri **errors on a resource
glob that matches nothing**, so without them even `cargo check` failed. electron-builder does
no such validation and `electron dist/main.cjs` needs nothing staged at all, so the flag lost
its reason and the staging became an ordinary step of `build-app.mjs`.

`buildDevApp()` went the same way. Its whole job was producing an app that carried NOTHING, so
the Rust would take its dev fallbacks. Unpackaged, `app.isPackaged` is false and
`process.resourcesPath` points inside `node_modules/electron`, so `hostCmd.bundled()` misses
and falls through to the repo tsx tier by itself — no config override, no `out/dev` copy, and
no way to end up running against a zero-byte `node.exe` placeholder.

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

The build number the menu displays is local wall-clock `YYYYMMDD.HHMM`, substituted into the
bundle by esbuild as `__STUDIO_BUILD__`, so it records when *this bundle* was produced rather
than when it happens to run.

## Platform traps

### Windows: use System32's `bsdtar` by path

It reads `.zip`. A bare `tar` can resolve to Git Bash's GNU tar depending on `PATH` order,
which does not.

### macOS: `hdiutil` is flaky here, and `make-dmg.mjs` is the way round it

electron-builder's `dmg` target is the normal path. But it drives `hdiutil` like Tauri's did
before it, and `hdiutil` fails on this machine with errno 35 (`EAGAIN`) out of
`CUDIFFileAccess::updateHeader` — on a trivial 5 MB image too, so it is not about our bundle.

`scripts/make-dmg.mjs` is the fallback, kept rather than deleted because the bug is still on
the machine: set `mac.target: ["dir"]` and run it against the built `.app`. It uses
`hdiutil create -srcfolder`, a different code path that works, staging the `.app` beside an
`/Applications` symlink (the drag-to-install affordance) and compressing in one step. What
that gives up is the styled Finder window — background art, icon positions.

It retries rather than silently shipping without a dmg; `-ov` makes a retry safe. EAGAIN means
"try again *later*" — retrying instantly just fails again (observed: three back-to-back
failures, then success moments later), so it backs off between attempts.

## Still repo-dependent

The app spawns the **file service** through the repo's `tsx` in a dev build, and a packaged
app carries its own bundle — but the engine itself is still built from this checkout.
