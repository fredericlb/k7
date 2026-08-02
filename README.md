# studio

The music and stage apps of the frediverse.

| app | what it is | dev site |
|---|---|---|
| `apps/radiok7` | rehearsal recorder — sessions, takes, tablature, tuner | `rec.test` |
| `apps/lanes` | text-first DAW — the web editor | `lanes.test` |
| `apps/mediatek` | the media library — morceaux, samples, modules | `mediatek.test` |
| `apps/moteur` | the native C++ audio engine (JUCE/Tracktion) | — |
| `apps/capot` | the Tauri tray that supervises the engine | — |
| `apps/obscura` | blind-test game — six SPAs behind one origin | `obscura.test` |

`packages/` is studio's shared tier, all `@studio/*` and consumed as raw
TypeScript source: the song compiler, the command layer, the engine client and
supervisor, the view engines, the waveform component. The engine and the tray
serve every audio app, not just lanes — hence their own directories. Anything
shared with the `phare` monorepo lives in `commons/` instead.

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

## The native parts

`apps/moteur` is a CMake/JUCE/Tracktion C++ project and `apps/capot` a
Tauri/Rust app. Neither is built by `turbo run build` — the moteur deliberately
declares no `build` script at all, so turbo can never try to compile C++. They
have their own commands:

```bash
npm run build:win --workspace moteur     # or build:mac
npm run engine:build --workspace capot   # engine + sidecars + the tray bundle
```

Their build directories are large (~30 GB combined) and fully gitignored. Both
bake absolute paths into their caches, so **moving or renaming the repo requires
wiping `apps/moteur/build` and `apps/capot/src-tauri/target`** — otherwise the
build fails looking for the old path.

## Images

```bash
npm run images          # all apps, or: npm run images radiok7
npm run check-images    # asserts no workspace package is missing from an image
```

See [commons/docs/images.md](commons/docs/images.md) — the base image and the
app images use two different build contexts.
