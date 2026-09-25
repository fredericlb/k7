# `npm run engine:portable`

`build-portable.mjs` produces **one Windows `.exe`** — `dist/st0-portable_<stamp>.exe` at the
monorepo root — carrying the C++ engine, the tray, the supervisor, the
vendored Node and every resource the app reads. Nothing is installed, nothing is required on
`PATH`, and the machine that runs it needs no checkout.

It is the portable counterpart of `npm run engine:build`, whose Windows deliverable is an NSIS
**installer**. Both exist because they answer different questions: the installer is what a
musician is handed, this is what the build machine runs to try the whole stack as one artifact.

## What it does not decide

The list of what the app carries belongs to `build-engine.mjs`, and this script does not hold a
second copy of it: it builds the engine, calls that script with `--sidecar-only`, and reads the
result out of `src-tauri/binaries/` and `src-tauri/resources/`. Adding a resource there is
enough for it to appear here — a divergence between the installer and the portable build would
otherwise show up only as a feature missing from one of them, months later.

What both scripts need — where `dist/` is, spawning, the Tauri CLI, the Rust host triple, the
build stamp — lives in `buildTools.mjs` for the same reason.

## The layout is the app's layout

`dist/portable/app/` is flat, and every path the app resolves is relative to the executable it
starts from:

| beside `st0-tray.exe` | read by |
|---|---|
| `node.exe` | `hostcmd.rs` — the supervisor's runtime |
| `st0-engine.exe` | `packages/engine-client/src/engineBinary.ts`, from `process.execPath`'s directory |
| `resources/engine-host.mjs` | `hostcmd.rs` |
| `resources/faust-libs` | `engine/st0-engine/engine/FaustPlugin.cpp` |
| `resources/node_modules` | the ONNX Runtime and `node-datachannel`, which the `.mjs` bundle could not inline |

The sidecars lose the `-<triple>` suffix Tauri names them with: that suffix is Tauri's
convention for *selecting* a sidecar, and the code above looks for the plain name.

`--dir-only` stops here. The directory is runnable as it stands, which is what makes a failure
in the packing half distinguishable from a failure in the app.

## One file, because it carries itself

There is no self-extractor on a stock Windows worth using — IExpress flattens directories, and
this layout is three levels deep — so the launcher is ours: `portable-stub.rs`, compiled by
plain `rustc`. No cargo project and no crates, because it needs a file read, a spawn and a
message box, and a second crate in the tree is a second thing to keep building.

The zip is **appended to the launcher**, followed by a 32-byte trailer: 16 bytes of build stamp,
the payload length, and the magic `ST0PORT1`. The stub reads its own file, finds the trailer,
and unpacks into `%LOCALAPPDATA%\st0\portable\<stamp>` — keyed on the stamp, so a newer
launcher never starts an older tree, and a second run of the same one starts immediately.

Unpacking goes through a `.unpacking` staging directory renamed into place at the end. A run
killed mid-extract otherwise leaves a tree that *looks* complete on the next launch, and the app
then dies on a file that was never written.

It shells out to **System32's `tar.exe` by path**, the same choice `build-engine.mjs` makes when
it extracts the vendored Node: that bsdtar reads `.zip`, and a bare `tar` may resolve to Git
Bash's GNU tar, which does not.

## Failures are loud

The stub is a `windows_subsystem = "windows"` binary, so it has no console to print to and a
quiet failure is indistinguishable from a dead double-click. Every error path ends in a message
box naming the file — a missing payload, a truncated archive, an extraction that failed, a tray
executable that is not there after unpacking.

## Limits

- **Windows only.** The script refuses to run elsewhere: the stub is Rust-on-Windows and the
  extraction is System32's bsdtar.
- **Unsigned.** SmartScreen prompts on first run, as it does for the NSIS installer.
- The unpacked tree is never garbage-collected. Each build stamp is its own directory under
  `%LOCALAPPDATA%\st0\portable`, and old ones are deleted by hand.
