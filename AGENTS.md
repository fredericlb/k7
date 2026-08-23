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
| the st0 frontend | `apps/st0/frontend/docs/` |
| the médiathèque | `apps/pl8/docs/` |
| the DJ desk | `packages/ui-turntables/docs/` |
| the project shell | `packages/project-shell/docs/` |
| the C++ engine | `engine/moteur/docs/` |
| the tray app | `engine/capot/docs/` |
| the rehearsal recorder | `apps/k7/docs/` |
| the blind-test game | `apps/z0/docs/` |
| the build scripts | `engine/capot/scripts/docs/` |
| the git repositories | `packages/git-repos/docs/` |
| CI and deployment, which belong to no single app | `docs/` |

(Those are notes for developers. `apps/st0/docs/` is the exception: it is the
user-facing documentation the app ships and renders at `/docs`.)

**Never** turn a multi-line comment into a one-liner by joining its lines: that
produces an unreadable 500-character line and can swallow a `biome-ignore` directive,
which silently stops working unless it starts its own comment. Condense to a single
sentence and move the rest to a doc page.

# This repo

`studio` holds the music/stage apps. The audio side is **three processes in three
directories**, which is why this overview lives at the root and not inside any
one app:

| dir | language | what it is |
|---|---|---|
| `engine/moteur` | C++ | The audio engine. Receives a compiled `ProjectDoc` over WebSocket, diffs it, plays audio, pushes transport and meter state back. **Never parses song files.** |
| `engine/capot` | Rust (Tauri v2) | The menu-bar **view** over the supervisor. Spawns `@studio/engine-host` and drives it over NDJSON on stdio. Computes no policy of its own. |
| `apps/st0` | TypeScript | The text-first DAW, and the only app that opens a project: `frontend` (React/Vite) + `backend` (Express — the engine registry only; it verifies pl8's session and mounts no auth routes). Owns the timeline; shares the chains view. **Modules and chains are authored here**, against a project where the plugin a module names is actually LOADED, and committed to the account's library repository (`packages/song/docs/sharedFolders.md`). A project is created from one of three **archetypes**, each named after the surface it opens on — `arrangement` (a timeline), `mix` (two decks and a crossfade — `packages/song/docs/setProject.md`), or `video` (a timeline and a viewport) — and a song holds **sound and picture** alike: video lanes on the same timeline, whose ruler reads bars or seconds, and a `viewport` surface that composites them (`docs/picture.md`). What it draws beyond its panes, it draws because the project DECLARED it, in `surfaces/` (`docs/surfaces.md`). It opens the account's **playlists** as well — `_playlists/` at the workspace root, listing songs that live in pl8's catalogue, which this app searches and uploads into across the origin (`frontend/docs/playlists.md`). A `turntables` surface NAMES one, and that is what the DJ desk's browser lists and what the machine pre-fetches before a gig. It owns the level above a project too: its **home page** — the ORIGIN with no project in the address — lists the account's repositories, the projects inside them, the libraries repository, the published shares and the deploy key (`frontend/docs/projects.md`), and its header is the one link out to pl8. It is the **front door**: it has no path prefix, so it answers `st0.priv.frediver.se` / `studio.frediver.se` itself, and a project is addressed `/<dépôt>/<projet>` — which makes every prefix the origin claims (`/pl8`, `/k7`, `/z0`, `/api`, `/auth`) a repository name that can never be opened — plus `/external`, reserved by st0 itself for the menu of surfaces a second device drives (`frontend/docs/external.md`). Opened ON one project otherwise, by an address rather than a picker — see `packages/project-shell/docs/launch.md`. |
| `apps/pl8` | TypeScript | The media library — songs, samples, recordings — hosted, with its own Express backend over a volume of files. It holds **no modules and no chains**: those are authored in st0, for the reason above. Nor any **playlists**: a playlist holds no bytes, only names of songs that stay right here, so it belongs in the repository it was written for rather than on this volume — `_playlists/` in the workspace, opened from st0's cog (`packages/song/docs/playlists.md`). st0 searches THIS catalogue and uploads into it. It answers under `/pl8`, one link from st0's home page — it WAS the origin root, and moved when the editor became the front door. `/auth/*` went with the root: it mounts no auth routes now and only VERIFIES the cookie st0 mints, the same as k7 and z0. It **registers** the account's git repositories, and stores the one deploy key and the published shares, serving `/api/projects` + `/api/shares` — a repository belongs to a person rather than to a machine, and this is the service that outlives every engine (`apps/pl8/docs/projects.md`). The REGISTER and nothing inside: it kept a bare blobless mirror of every repository to answer "what projects are in there", and that copy is gone — the engine's machine holds the working clone and answers from it (`apps/st0/frontend/docs/projects.md`). It no longer DRAWS any of that: the screen is st0's home page, and this app's own front door is the catalogue. Both of those moved for one reason — pl8 is what a project draws ON, so what is AUTHORED and what is CHOSEN both belong to the editor. |
| `apps/z0` | TypeScript | The blind-test game — six SPAs behind one origin. Five are the game; the sixth, `editor`, opens a `.z0` project out of a git repository and is where st0's home page sends a `.z0` row. It replaced a Grist round-builder that held the same path. |
| `apps/k7` | TypeScript | The rehearsal recorder — sessions, takes, tablature, tuner. |

`packages/` is **studio's own shared tier**. All are `@studio/*` and are consumed
as **raw TypeScript source**: no build step, imported through `package.json`
`exports` subpaths, so a bare deep import fails on purpose.

| group | packages |
|---|---|
| the song | `song` (folder of YAML → `ProjectDoc` + `GraphDoc`, and the SAME folder → `VideoProjectDoc` for its picture — `docs/picture.md`; a project is one of three SHAPES, `docs/setProject.md`; it also owns the WORKSPACE's shape around a project — the shared folders, and `_playlists/`, `docs/playlists.md`), `commands` (one verb list for every surface), `translator` (`.dawproject` import), `dsp` (write a module's DSP in JS) |
| the engine | `engine-protocol` (the wire, mirrored in C++), `engine-client` (Node), `engine-browser` (browser + React store; its `access` subpath is the ONE way an app reaches an engine — routes, probe, policy, lease, bound to that service's prefix), `engine-host` (the supervisor — a **program**, not a library), `engine-registry` (which engines exist; each service holds its own registry INSTANCE — one shared implementation, `createRegistry()` per service) |
| the disk | `file-service` (every file operation, on the engine's machine — st0's backend has none), `mediatek` (the media library), `user-prefs`, `git-repos` (the SSH URI vocabulary and the deploy key) |
| the views | `project-shell` (what an app needs BEFORE it can draw: the launch parameters, the file-service transport, the repository → workspace resolution, the gate — st0 and z0's editor mount the same one — and when a session goes to sleep, `docs/idle.md`), `ui-chains` + `ui-chains-react` (the chains graph — st0 and pl8 both draw it), `ui-editor` (YAML + note grids, and the autosave every text pane runs on,
`docs/autosave.md`), `ui-eyes` (WebGL video — st0's `viewport` surface), `ui-timeline` (what an arrangement surface needs whatever its unit is: wheel zoom, middle-drag pan, a ruler's tick chooser, the lane geometry — st0's ruler reads bars OR seconds, since one grid draws a song and its picture), `ui-waveform`, `ui-module-builder` (st0 and pl8), `ui-turntables` (the DJ desk — st0's `turntables` surface; its one seam is the engine, `docs/hosting.md`, and `docs/` holds the desk's whole rationale plus the two harnesses that measure a SOUND) |
| the types | `web-protocol`, `graph-model` (split out so drawing a graph doesn't drag in auth) |
| z0 | `player-web` — the blind-test player, with a moteur-backed seam behind it |

Two of these are **processes rather than libraries** and are bundled, not imported:
`file-service` (`bin: studio-file-service`) and `engine-host` (`src/main.ts`). Both are
esbuilt into the tray by `engine/capot/scripts/build-engine.mjs`.

They are named `@studio/*` rather than `@st0/*` because st0 is only one of
their consumers: `apps/pl8` drives them too, and z0's moteur-backed player is
behind the seam `@studio/player-web` already had.

**In production the four apps above are ONE image**, `apps/studio/docker/` — st0 at the
origin root, pl8, k7 and z0 under their prefixes, four backends beside one nginx that owns
the path routing. Same shape as phare's monolith, and for the same reason: they already
shared a hostname, a session cookie and pl8's prefixless `/auth/*`, so four images only
meant the edge held a path table that belongs next to the apps. `engine/moteur` and
`engine/capot` are not in it and never will be — they run on the musician's machine.
`docs/versioning.md` is the page, including what one container costs.

Notes for the whole repo — CI, deployment, the dev session — are in `docs/`:
[dev.md](docs/dev.md) (what `npm run dev` starts), [versioning.md](docs/versioning.md),
and two plan/recipe pages, [module-builder-plan.md](docs/module-builder-plan.md) and
[rename-test-plan.md](docs/rename-test-plan.md) — the latter **historical**, written for
`lanes → pistes` and two renames stale in its names; its method is what survives.
[constat.md](docs/constat.md) is the transversal reading of the audio axis — performance,
stability and dead code in one place, dated and with the commands to replay it. Start there
when you don't yet know which of the four specialised pages you need.
[inventaire.md](docs/inventaire.md) is the standing inventory of dead and duplicated code —
read it before deleting anything that merely *looks* unused, and note it now has a TOOL:
`npm run lint:dead` (knip), non-blocking, scoped to the audio axis.

Two other checks guard what no test would: `npm run lint:bytes` refuses a NUL byte in a tracked
source file (ripgrep skips such a file whole, so it stops existing for every sweep), and
**`npm run lint:docs` refuses a `.md` that names a source file which is not there**. That second
one exists because the method of this repo is that the WHY lives in the prose — a page pointing at
a file two renames ago sends the reader into a wall, and twenty-two of them had built up. It knows
about TOMBSTONES: a page naming a file precisely *because* it went is listed in the script, with
the reason, rather than rewritten.
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

On the Windows dev machine, **editing** (claude, nvim…) happens in the
`console.priv.frediver.se` tabs — Git Bash by default — while
**every build and every dev server belongs to Tilt** (`npm run dev` = `tilt up`, one
resource per server, UI at http://localhost:10350). So never build by hand there:
save (or `tilt trigger <resource>`), wait for Tilt to finish, then read
`tilt get uiresources` / `tilt logs <resource>` to see if something is wrong. The
tray is not used in dev: the engine is self-sufficient. See docs/remote.md.
