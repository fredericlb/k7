# General rules on development

- Prioritize using existing libraries whenever possible. When you found one, show its strengths and weaknesses and ask if you should include it. 
- Comments at the top of a file should summarize what the file is doing in less than 5 lines. If it is not possible to explain this clearly in <=5 lines, add a md file explaining it fully in docs/[topic].md
- Inline comments should be one-liners

Those two rules hold in every language here — TypeScript, Rust, C++ — and they are
about *where* the prose lives, not about having less of it. This codebase writes down
the **why**. Long rationale belongs in the zone's `docs/` directory:

| zone | pages live in |
|---|---|
| a shared package | `packages/<pkg>/docs/` |
| the l8 frontend | `apps/l8/frontend/docs/` |
| the médiathèque | `apps/st0/docs/` |
| m9 | `apps/m9/docs/` |
| v1 | `apps/v1/docs/` |
| the project shell | `packages/project-shell/docs/` |
| the C++ engine | `engine/moteur/docs/` |
| the tray app | `engine/capot/docs/` |
| the rehearsal recorder | `apps/k7/docs/` |
| the blind-test game | `apps/z0/docs/` |
| the build scripts | `engine/capot/scripts/docs/` |
| the git repositories | `packages/git-repos/docs/` |
| CI and deployment, which belong to no single app | `docs/` |

(Those are notes for developers. `apps/l8/docs/` is the exception: it is the
user-facing documentation the app ships and renders at `/docs`.)

**Never** turn a multi-line comment into a one-liner by joining its lines: that
produces an unreadable 500-character line and can swallow a `biome-ignore` directive,
which silently stops working unless it starts its own comment. Condense to a single
sentence and move the rest to a doc page.

# This repo

`studio` holds the music/stage apps. The audio side is **four processes in four
directories**, which is why this overview lives at the root and not inside any
one app:

| dir | language | what it is |
|---|---|---|
| `engine/moteur` | C++ | The audio engine. Receives a compiled `ProjectDoc` over WebSocket, diffs it, plays audio, pushes transport and meter state back. **Never parses song files.** |
| `engine/capot` | Rust (Tauri v2) | The menu-bar **view** over the supervisor. Spawns `@studio/engine-host` and drives it over NDJSON on stdio. Computes no policy of its own. |
| `apps/l8` | TypeScript | The text-first DAW: `frontend` (React/Vite) + `backend` (Express — the engine registry only; it verifies st0's session and mounts no auth routes). Owns the timeline; shares the chains view. It is **opened on one project** by st0 and picks nothing itself — see `packages/project-shell/docs/launch.md`. |
| `apps/st0` | TypeScript | The media library — songs, samples, modules — hosted, with its own Express backend over a volume of files. **The only editable catalogue**, so it is where a module is authored; the builder itself is `@studio/ui-module-builder`, which l8 draws too. It also connects to a local `engine/moteur` to ask a plugin what its parameters are. It is the **home page**: it has no path prefix, so it answers `studio.test` / `studio.frediver.se` itself — and therefore owns `/auth/*` for the whole origin, since the registered `redirect_uri` has no prefix either. It also owns the account's **git repositories** and the one deploy key, and launches l8 on a project (`apps/st0/docs/projects.md`). |
| `apps/v1` | TypeScript | **l8's picture half, on its own** — `frontend/` plus `backend/` (this service's machine registry; auth is st0's, verified here). It opens on one `*.v1` project — a **cut**: a viewport and a stack of lanes, every position a decimal SECOND (`packages/song/docs/v1Project.md`) — and shows two views: Montage and Édition. **It reaches no `engine/moteur`**: a cut has no audio, so the transport is its own clock and the only thing it wants from a machine is that machine's file service — the project's YAML, and the footage bytes. |
| `apps/m9` | TypeScript | **l8 without the timeline** — `frontend/` plus `backend/` (this service's engine registry, and which machine the account works from; auth is st0's, verified here). It opens on one `*.m9` project — a **set**: `songs.yaml` naming médiathèque songs, plus two decks meeting at a crossfade in `chains.yaml` (`packages/song/docs/m9Project.md`) — and shows three views: Mix, Édition, Graphe. Mix is still the **decks**, which read the médiathèque's cache on the chosen machine through that machine's file service and play through its `engine/moteur`, because the engine opens file paths and cannot fetch a URL. |
| `apps/z0` | TypeScript | The blind-test game — six SPAs behind one origin. |
| `apps/k7` | TypeScript | The rehearsal recorder — sessions, takes, tablature, tuner. |

`packages/` is **studio's own shared tier**. All are `@studio/*` and are consumed
as **raw TypeScript source**: no build step, imported through `package.json`
`exports` subpaths, so a bare deep import fails on purpose.

| group | packages |
|---|---|
| the song | `song` (folder of YAML → `ProjectDoc` + `GraphDoc` for l8/m9, or → `VideoProjectDoc` for v1), `commands` (one verb list for every surface), `translator` (`.dawproject` import), `dsp` (write a module's DSP in JS) |
| the engine | `engine-protocol` (the wire, mirrored in C++), `engine-client` (Node), `engine-browser` (browser + React store; its `access` subpath is the ONE way an app reaches an engine — routes, probe, policy, lease, bound to that service's prefix), `engine-host` (the supervisor — a **program**, not a library), `engine-registry` (which engines exist; each service holds its own registry INSTANCE — one shared implementation, `createRegistry()` per service) |
| the disk | `file-service` (every file operation, on the engine's machine — l8' backend has none), `mediatek` (the media library), `user-prefs`, `git-repos` (the SSH URI vocabulary, the deploy key, and the bare blobless mirror st0 reads a repository through) |
| the views | `project-shell` (what an app needs BEFORE it can draw: the launch parameters, the file-service transport, the repository → workspace resolution, the gate — l8, m9 and v1 mount the same one), `ui-chains` + `ui-chains-react` (the chains graph — l8, st0 and m9 all draw it), `ui-editor` (YAML + note grids — l8, m9 and v1 — and the autosave every text pane runs on,
`docs/autosave.md`), `ui-eyes` (WebGL video — v1's renderer), `ui-timeline` (what an arrangement surface needs whatever its unit is: wheel zoom, middle-drag pan, a ruler's tick chooser, the lane geometry — l8 measures in beats and v1 in seconds), `ui-waveform`, `ui-module-builder` (l8 and st0) |
| the types | `web-protocol`, `graph-model` (split out so drawing a graph doesn't drag in auth) |
| z0 | `player-web` — the blind-test player, with a moteur-backed seam behind it |

Two of these are **processes rather than libraries** and are bundled, not imported:
`file-service` (`bin: studio-file-service`) and `engine-host` (`src/main.ts`). Both are
esbuilt into the tray by `engine/capot/scripts/build-engine.mjs`.

They are named `@studio/*` rather than `@l8/*` because l8 is only one of
their consumers: `apps/st0` and `apps/m9` both drive them now, and
z0's moteur-backed player is behind the seam `@studio/player-web` already
had.

Notes for the whole repo — CI, deployment, the dev session — are in `docs/`:
[dev.md](docs/dev.md) (what `npm run dev` starts), [versioning.md](docs/versioning.md),
and two plan/recipe pages, [module-builder-plan.md](docs/module-builder-plan.md) and
[rename-test-plan.md](docs/rename-test-plan.md) — the latter **historical**, written for
`lanes → pistes` and two renames stale in its names; its method is what survives.
[inventaire.md](docs/inventaire.md) is the standing inventory of dead and duplicated code —
read it before deleting anything that merely *looks* unused.
[audit-moteur.md](docs/audit-moteur.md) is the standing audit of everything that links a
surface to `engine/moteur` — what is shared, what is copied, where the connections give way,
and the plan by lots. Read it before touching the registry, the relay or a gate.

`commons/` is a **git submodule** — the shared base, also used by the `phare`
monorepo. Editing something under `commons/` means committing in two places:

```bash
cd commons && git commit -am "…" && cd ..
git add commons && git commit -m "bump commons"
```

`push.recurseSubmodules=on-demand` is configured, so pushing the parent pushes
commons first. Never edit `commons/` for something only studio needs — put it in
`packages/` instead: that is the line between "shared with phare" and "shared
inside studio".

# Developing on Windows

**Windows only** — on macOS and Linux everything is simpler: edit and build in the
same world, run `npm run dev`, and none of the following applies.

On the Windows dev machine the worlds are split: **editing** (claude, nvim…) lives
in WSL — the default shell of the `/console` tabs — while **every build and every
dev server belongs to Tilt** on the Windows side (`tilt up`, one resource per
server, UI at https://studio.test:10351). So never build by hand there: save (or
`tilt trigger <resource>`), wait for Tilt to finish, then read
`tilt get uiresources` / `tilt logs <resource>` to see if something is wrong. The
tray is not used in dev: the engine is self-sufficient. See docs/remote.md.
