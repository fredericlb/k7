# studio

The music and stage apps of the frediverse.

| app | what it is | dev site |
|---|---|---|
| `apps/radiok7` | rehearsal recorder — sessions, takes, tablature, tuner | `rec.test` |
| `apps/lanes` | text-first DAW: web UI + native C++ audio engine + Tauri tray | `lanes.test` |
| `apps/obscura` | blind-test game — six SPAs behind one origin | `obscura.test` |

`packages/ui-waveform` (`@studio/ui-waveform`) is shared between radiok7's
recorder and lanes' frontend. Anything shared with the `phare` monorepo lives in
`commons/` instead.

## Getting started

```bash
git clone --recurse-submodules <url> studio
```

If you already cloned without it: `git submodule update --init`.

```bash
npm ci
cp env.example.yaml env.yaml   # then fill in the secrets
npm run caddy                  # one Caddy serves studio AND phare — see commons/docs/caddy.md
cd apps/radiok7 && npm run dev
```

## The commons submodule

`commons/` is a real checkout of the [commons](../commons) repo, shared with
`phare`. It is declared in this repo's npm workspaces, so its packages resolve
as plain workspace symlinks and are consumed as raw TypeScript — edit a
component there and the app picks it up immediately.

The cost is a double commit:

```bash
cd commons && git commit -am "…" && cd ..
git add commons && git commit -m "bump commons"
```

`push.recurseSubmodules=on-demand` is set, so `git push` publishes commons
before the pointer — without it you'd push a pointer to a commit nobody can
fetch. To pull a commons change made from phare: `npm run commons:sync`.

## lanes' native parts

`apps/lanes/engine` is a CMake/JUCE/tracktion C++ project and
`apps/lanes/engine-tray` a Tauri/Rust app. Neither is built by `turbo run build`
— they have their own commands:

```bash
cd apps/lanes
npm run lanes:build:win        # or lanes:build:mac
npm run build --workspace capot
```

Their build directories are large (~30 GB combined) and fully gitignored. Both
bake absolute paths into their caches, so **moving or renaming the repo requires
wiping `engine/build` and `engine-tray/src-tauri/target`** — otherwise the build
fails looking for the old path.

## Images

```bash
npm run images          # all apps, or: npm run images radiok7
npm run check-images    # asserts no workspace package is missing from an image
```

See [commons/docs/images.md](commons/docs/images.md) — the base image and the
app images use two different build contexts.
