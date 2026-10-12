# `npm run engine:portable`

`build-portable.mjs` produces **one Windows `.exe`** — `dist/st0-portable_<stamp>.exe` at the
monorepo root — carrying the tray, the supervisor, the C++ engine and every library they load.
Nothing is installed, nothing is required on `PATH`, and the machine that runs it needs no
checkout.

It is the portable counterpart of `npm run engine:build`, whose Windows deliverable is an NSIS
**installer**. Both exist because they answer different questions: the installer is what a
musician is handed, this is what the build machine runs to try the whole stack as one artifact.

## What it does not decide

What the app carries belongs to `scripts/stage.mjs`, and this script holds no second copy of it:
it builds the engine and the supervisor, then runs the same `npm run package` the installer comes
from, asking electron-builder for its `portable` target instead. A divergence between the
installer and the portable build would otherwise show up only as a feature missing from one of
them, months later.

`--skip-engine` reuses whatever is already built. `--dir-only` stops at `out/win-unpacked`, which
runs as it stands — what makes a failure in the packing half distinguishable from a failure in the
app.

## Limits

- **Windows only.** electron-builder's portable target is a Windows self-extractor.
- **It unpacks on every launch**, into a temporary folder, so a start is slower than the
  installed app's. Acceptable for what it is for.
- **Unsigned.** SmartScreen prompts on first run, as it does for the NSIS installer.
