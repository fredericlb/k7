# studio

The music and stage apps of the frediverse.

| app | what it is | dev site |
|---|---|---|
| `apps/k7` | rehearsal recorder — sessions, takes, tablature, tuner | `k7.priv.st0.app` |
| `apps/st0` | text-first DAW — the web editor; the origin's front door | `priv.st0.app` |
| `apps/pl8` | the media library — songs, samples, recordings | `play.priv.st0.app` |
| `engine/st0-engine` | the native C++ audio engine (JUCE/Tracktion) | — |
| `engine/st0-supervisor` | the engine machine's supervisor: starts and watches the engine, holds its tunnel | — |
| `engine/st0-tray` | the menu-bar tray, a view over the supervisor (Tauri) | — |
| `apps/z0` | blind-test game — six SPAs behind one origin | `priv.st0.app/z0` |

`packages/` is studio's shared tier, all `@studio/*` and consumed as raw
TypeScript source: the song compiler, the command layer, the engine client and
supervisor, the view engines, the waveform component. The engine, its supervisor and the tray
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

In dev the studio answers at **https://priv.st0.app** — st0 at the root, z0 under `/z0` —
with pl8 and k7 on their own subdomains, `play.priv.st0.app` and `k7.priv.st0.app`
(`packages/web-protocol/services.ts`).
Nothing here terminates TLS: the name resolves to the LAN server, which reverse-proxies to
the dev servers. See [docs/dev.md](docs/dev.md).

`npm run dev` runs the whole studio as one Tilt session — every app's frontend and
backend, plus a task that builds the C++ engine and launches the desktop app,
and rebuilds+restarts both on save. One app on its own is still `npm run dev` inside its
directory. See [docs/dev.md](docs/dev.md).

## The commons submodule

`commons/` is a real checkout of the [commons](commons) repo, shared with
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

`engine/st0-engine` is a CMake/JUCE/Tracktion C++ project, `engine/st0-supervisor` a C++ program
beside it, and `engine/st0-tray` a Tauri app over the supervisor. None is in a deployed image —
each `docker/Dockerfile` names the workspaces it installs rather than globbing. The moteur
deliberately declares no `build` script at all, so `npm run build --workspaces --if-present` can
never try to compile C++. They have their own commands:

```bash
npm run build:win --workspace st0-engine     # or build:mac
npm run engine:build --workspace st0-tray    # engine + supervisor + tray app, into dist/
```

`engine/st0-engine/build` is large (~30 GB) and fully gitignored. It bakes absolute paths into
its caches, so **moving or renaming the repo requires wiping it** — otherwise the build
fails looking for the old path.

## Images

```bash
npm run images          # all apps, or: npm run images k7
npm run check-images    # asserts no workspace package is missing from an image
```

See [commons/docs/images.md](commons/docs/images.md) — the base image and the
app images use two different build contexts.
