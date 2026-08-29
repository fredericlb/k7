# studio

The music and stage apps of the frediverse.

| app | what it is | dev site |
|---|---|---|
| `apps/k7` | rehearsal recorder — sessions, takes, tablature, tuner | `st0.priv.frediver.se/k7` |
| `apps/st0` | text-first DAW — the web editor; the origin's front door | `st0.priv.frediver.se` |
| `apps/pl8` | the media library — songs, samples, recordings | `st0.priv.frediver.se/pl8` |
| `engine/moteur` | the native C++ audio engine (JUCE/Tracktion) | — |
| `apps/studio-desktop` | the desktop app that supervises the engine | — |
| `apps/z0` | blind-test game — six SPAs behind one origin | `st0.priv.frediver.se/z0` |

`packages/` is studio's shared tier, all `@studio/*` and consumed as raw
TypeScript source: the song compiler, the command layer, the engine client and
supervisor, the view engines, the waveform component. The engine and the desktop app
serve every audio app, not just st0 — hence their own directories. Anything
shared with the `phare` monorepo lives in `commons/` instead.

## Getting started

```bash
git clone --recurse-submodules <url> studio
```

If you already cloned without it: `git submodule update --init`.

```bash
npm ci
cp env.example.yaml env.yaml   # then fill in the secrets
npm run dev                    # every app, plus the engine and the desktop app
```

The studio answers at **https://st0.priv.frediver.se** — one origin, one path per service.
Nothing here terminates TLS: the name resolves to the LAN server, which reverse-proxies to
the dev servers. See [docs/dev.md](docs/dev.md).

`npm run dev` runs the whole studio as one turbo session — every app's frontend and
backend, plus a task that builds the C++ engine and launches the desktop app,
and rebuilds+restarts both on save. One app on its own is still `npm run dev` inside its
directory. See [docs/dev.md](docs/dev.md).

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

## What runs on the musician's machine

`engine/moteur` is a CMake/JUCE/Tracktion C++ project; `apps/studio-desktop` is an Electron
app around it. Neither is in the deployed image — the desktop app sits under `apps/` with the
server apps, and stays out of the image because `turbo prune` names its packages rather than
globbing the directory. The moteur deliberately declares no `build` script at all, so turbo can
never try to compile C++. They have their own commands:

```bash
npm run build:win --workspace moteur     # or build:mac
npm run app:setup --workspace studio-desktop      # once: fetch the Electron runtime
npm run engine:build --workspace studio-desktop   # engine + staging + the packaged app
```

`engine/moteur/build` is large (~30 GB) and fully gitignored. It bakes absolute paths into
its caches, so **moving or renaming the repo requires wiping it** — otherwise the build
fails looking for the old path.

## Images

```bash
npm run images          # all apps, or: npm run images k7
npm run check-images    # asserts no workspace package is missing from an image
```

See [commons/docs/images.md](commons/docs/images.md) — the base image and the
app images use two different build contexts.
