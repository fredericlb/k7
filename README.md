# studio

The music and stage apps of the frediverse.

| app | what it is | dev site |
|---|---|---|
| `apps/k7` | text-first DAW — the web editor, the media library (songs, samples, recordings, under `/media`) and the rehearsal recorder (sessions, takes, songbook, tuner, under `/rehearsal`); the origin's front door | `app.priv.k7.rocks` |
| `engine/k7-runtime` | the native C++ audio engine (JUCE/Tracktion) | — |
| `engine/k7-supervisor` | the engine machine's supervisor: starts and watches the engine, holds its tunnel | — |
| `apps/k7-tray` | k7 on a computer (Tauri, in the menu bar): runs k7's backend, which runs the supervisor and its engine; k7 opens in the browser | — |

`packages/` is studio's shared tier, all `@studio/*` and consumed as raw
TypeScript source: the song compiler, the command layer, the engine client and
supervisor, the view engines, the waveform component. The engine and its supervisor
serve every audio app, not just k7 — hence their own directories. Anything
shared with the `phare` monorepo lives in `commons/` instead.

## Getting started

```bash
git clone --recurse-submodules <url> studio
```

If you already cloned without it: `git submodule update --init`.

```bash
npm ci
cp env.example.yaml env.yaml   # then fill in the secrets
npm run dev                    # every app, plus the engine
```

In dev the studio answers at **https://app.priv.k7.rocks** — k7 at the root, the media library
under `/media`, the rehearsal recorder under `/rehearsal` — and its documentation at
**https://docs.priv.k7.rocks**; in production, `app.k7.rocks` and `docs.k7.rocks`
(`packages/web-protocol/services.ts`).
Nothing here terminates TLS: the name resolves to the LAN server, which reverse-proxies to
the dev servers. See [docs/dev.md](docs/dev.md).

`npm run dev` runs the whole studio as one Tilt session — every app's frontend and
backend, plus a task that builds the C++ engine and runs it,
and rebuilds+restarts it on save. One app on its own is still `npm run dev` inside its
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

`engine/k7-runtime` is a CMake/JUCE/Tracktion C++ project, `engine/k7-supervisor` a C++ program
beside it — run from the command line as `k7-supervisor --config engine.json`, or carried by
the tray, `apps/k7-tray`, through k7's backend. The two programs also run on the server, in the
`k7-runtime` image (`docs/server-engine.md`); the tray is in no image —
each `docker/Dockerfile` names the workspaces it installs rather than globbing. The moteur
deliberately declares no `build` script at all, so `npm run build --workspaces --if-present` can
never try to compile C++. They have their own commands:

```bash
npm run build:win --workspace k7-runtime     # or build:mac
npm run engine:build                         # engine + supervisor, staged into dist/k7-runtime/
```

`engine/k7-runtime/build` is large (~30 GB) and fully gitignored. It bakes absolute paths into
its caches, so **moving or renaming the repo requires wiping it** — otherwise the build
fails looking for the old path.

## Images

```bash
npm run images          # k7's image, the one this repo builds
npm run check-images    # asserts no workspace package is missing from an image
```

See [commons/docs/images.md](commons/docs/images.md) — the base image and the
app images use two different build contexts.

## License

studio is licensed under the GNU General Public License, version 3 — see [LICENSE](LICENSE).
The notices of the third-party code the engine compiles are in
[engine/k7-runtime/LICENSE](engine/k7-runtime/LICENSE).
