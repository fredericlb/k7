# General rules on development

- Prioritize using existing libraries whenever possible. When you found one, show its strengths and weaknesses and ask if you should include it.
- **A source file over 500 lines is suspect.** Split it unless there is a reason not to, and say the reason.
- **Comments are in English**, everywhere, whatever the language of the surrounding docs.
- **A file header is at most 10 lines.** What the file does, and the one thing a reader would get wrong.
- **A comment inside the body is exactly one line.** No exceptions, no wrapped sentences, no JSDoc paragraphs.
- Long rationale goes to the zone's `docs/` page, and the code points at it.
- **Icons come from `@frediverse/ui/icons`**, never an emoji or a direct `lucide-react` import — `commons/packages/ui/docs/icons.md`.
- **Documentation is in English**, like the comments — including the pages in every `docs/`.
- **A page carries CHOICES, not mechanism.** What was decided and what forced it. Not a
  walkthrough of what happens when: the code is what says how a thing works, and prose that
  restates it is prose that goes stale without anyone noticing.
- **A page describes the project AS IT IS.** No history: no "it used to be", no account of what
  a change replaced, no migration narrative. Where a past failure is what justifies a decision,
  state the hazard in the present tense and drop the story.

These rules hold in every language here — TypeScript and C++. They are about *where* the
prose lives and *how much* of it sits in the code: this codebase still writes down the **why**,
but a reader scrolling past forty lines of justification to reach a function is paying for it.
The zone's `docs/` directory is where that justification belongs:

| zone | pages live in |
|---|---|
| a shared package | `packages/<pkg>/docs/` |
| the st0 frontend | `apps/st0/frontend/docs/` |
| the médiathèque | `apps/pl8/docs/` |
| the DJ desk | `packages/st0-plugins/docs/turntables/` |
| the project shell | `packages/project-shell/docs/` |
| the C++ engine | `engine/st0-engine/docs/` |
| the menu-bar tray | `engine/st0-tray/docs/` |
| the rehearsal recorder | `apps/k7/docs/` |
| the blind-test game | `apps/z0/docs/` |
| the build scripts | `engine/st0-tray/scripts/docs/` |
| the git repositories | `packages/git-repos/docs/` |
| the plugin contract | `packages/st0-sdk/docs/` |
| st0's builtin plugins | `packages/st0-plugins/docs/` |
| CI and deployment, which belong to no single app | `docs/` |

(Those are notes for developers. `apps/st0/docs/` is the exception: it is the
user-facing documentation the app ships and renders at `/docs`.)

**Never** turn a multi-line comment into a one-liner by joining its lines: that
produces an unreadable 500-character line and can swallow a `biome-ignore` directive,
which silently stops working unless it starts its own comment. Condense to a single
sentence and move the rest to a doc page.

`npm run lint:comments` enforces the three limits above — header length, body one-liners, and
no accented prose where English is expected. It is **non-blocking**, like `lint:dead`: it reports
a debt that predates the rule and shrinks as files are touched. New code has no excuse.

# This repo

`studio` holds the music/stage apps. The audio side is **three processes**, which is why
this overview lives at the root and not inside any one app. Two of them run on the
musician's machine and never in the image — `engine/st0-engine` and `engine/st0-tray`,
the latter sitting under `apps/` with the server apps but shipped to nobody's server:

| dir | language | what it is |
|---|---|---|
| `engine/st0-engine` | C++ | The audio engine. Receives a compiled `ProjectDoc` over WebSocket, diffs it, plays audio, pushes transport and meter state back. **Never parses song files.** |
| `engine/st0-tray` | Rust (Tauri v2) | The menu-bar **view** over the supervisor. Spawns `@studio/engine-host` and drives it over NDJSON on stdio. Computes no policy of its own. |
| `apps/st0` | TypeScript | The text-first DAW, and the only app that opens a project: `frontend` (React/Vite) + `backend` (Express — the engine registry only; it verifies pl8's session and mounts no auth routes). Owns the timeline; shares the chains view. **Modules and chains are authored here**, against a project where the plugin a module names is actually LOADED, and committed to the account's library repository (`packages/song/docs/sharedFolders.md`). A project is created from one of five **archetypes**: three named after the surface they open on — `arrangement` (a timeline), `mix` (two decks and a crossfade — `packages/song/docs/setProject.md`), `video` (a timeline and a viewport) — and the two `live` ones, named after what they ARE: a rig you play THROUGH, with nothing arranged and no lane of any kind — an input, a fader, the master run, and in `live-video` a webcam feeding RENDER plus the one viewport a picture cannot do without (`packages/song/docs/liveProject.md`) — and a song holds **sound and picture** alike: video lanes on the same timeline, whose ruler reads bars or seconds, and a `viewport` surface that composites them (`docs/picture.md`). What it draws beyond its panes, it draws because the project DECLARED it, in `surfaces/` (`docs/surfaces.md`). It opens the account's **playlists** as well — `_playlists/` at the workspace root, listing songs that live in pl8's catalogue, which this app searches and uploads into across the origin (`frontend/docs/playlists.md`). A `turntables` surface NAMES one, and that is what the DJ desk's browser lists and what the machine pre-fetches before a gig. Beside those, `_references/` — the finished mixes you listen AGAINST, uploaded there and played by the BROWSER so a reference sounds over a live rig or a running arrangement without going near the engine (`frontend/docs/references.md`). It owns the level above a project too: its **home page** — the ORIGIN with no project in the address — lists the account's repositories, the projects inside them, the libraries repository and the published shares (`frontend/docs/projects.md`) — the deploy key moved off it, to the Sync tab of `/@settings`, which is the one tab of that screen the hosted origin still draws (`engine/st0-tray/docs/tray.md`), and its header carries the origin's app SWITCH, the one pl8's header carries too (`packages/ui-app-switch/docs/appSwitch.md`). It is the **front door**: it has no path prefix, so it answers `st0.priv.frediver.se` / `studio.frediver.se` itself, and a project is addressed `/<dépôt>/<projet>` — which makes every prefix the origin claims (`/pl8`, `/k7`, `/z0`, `/api`, `/auth`) a repository name that can never be opened — plus `/external`, reserved by st0 itself for the menu of surfaces a second device drives (`frontend/docs/external.md`). Opened ON one WORKSPACE otherwise, by an address rather than a picker — see `packages/project-shell/docs/launch.md`. A workspace is one git repository holding SEVERAL projects: the editor's tree is the whole of it and a ▶ on a project row is what hands that one to the engine (`packages/file-service/docs/activeProject.md`). It need not have a repository at all — one is created locally, git-initialised with no remote, and gets an `origin` the day it is published (`packages/file-service/docs/workspaces.md`). |
| `apps/pl8` | TypeScript | The media library — songs, samples, recordings — hosted, with its own Express backend over a volume of files. It holds **no modules and no chains**: those are authored in st0, for the reason above. It DOES hold **playlists**, under `playlists/` on the volume and with a tab of their own — a root zone rather than a family, since a set list names songs and carries no bytes (`apps/pl8/docs/playlists.md`). A workspace keeps its own under `_playlists/`, in the same format and for a different job: those are versioned with the songs they were written for, and are the ones a `turntables` surface can name (`packages/song/docs/playlists.md`). st0 searches THIS catalogue and uploads into it. It answers under `/pl8`, one link from st0's home page. It mounts no auth routes and only VERIFIES the cookie st0 mints, the same as k7 and z0. It **registers** the account's git repositories, and stores the one deploy key and the published shares, serving `/api/projects` + `/api/shares` — a repository belongs to a person rather than to a machine, and this is the service that outlives every engine (`apps/pl8/docs/projects.md`). The REGISTER and nothing inside: it holds no copy of a repository, and the engine's machine answers "what projects are in there" from its working clone (`apps/st0/frontend/docs/projects.md`). It DRAWS none of that either: the screen is st0's home page, and this app's own front door is the catalogue. One reason for both — pl8 is what a project draws ON, so what is AUTHORED and what is CHOSEN belong to the editor. |
| `apps/z0` | TypeScript | The blind-test game — six SPAs behind one origin. Five are the game; the sixth, `editor`, opens a `.z0` project out of a git repository and is where st0's home page sends a `.z0` row. |
| `apps/k7` | TypeScript | The rehearsal recorder — sessions, takes, tablature, tuner. |

`packages/` is **studio's own shared tier**. All are `@studio/*` and are consumed
as **raw TypeScript source**: no build step, imported through `package.json`
`exports` subpaths, so a bare deep import fails on purpose.

| group | packages |
|---|---|
| the song | `song-schema` (the FILE FORMAT and the value vocabulary around it — one zod schema and one reader/writer per kind of YAML file, plus `timecode`, `moduleTypes`, `playlist`, `stems`… Nothing in it touches `node:fs`, which is the whole point: **this is the half a browser may import**, and st0's frontend, pl8, `ui-editor`, `ui-module-builder`, `st0-plugins` (the desk) and `project-shell` depend on it INSTEAD of on `song`), `song-edit` (CHANGING a project rather than compiling one — params, assets, events, material, time; every write goes through a YAML writer that changes the value and nothing else, so a knob drag stays a one-line diff), `song` (folder of YAML → `ProjectDoc` + `GraphDoc` — the compile, the loader and every disk walk, and only READING; a project is one of three SHAPES, `docs/setProject.md`; it also owns the WORKSPACE's shape around a project — the shared folders, the third library family `_libraries/assemblies/` and the `assemblies/` a project draws its nodes as BOXES with, `docs/assemblies.md`, and `_playlists/`, `docs/playlists.md`), `song-video` (the SAME folder → `VideoProjectDoc` for its picture — the video document model, the lane and chain compile, the shaders; `packages/song-video/docs/picture.md`. Split out because a song's sound compiles without any of it; what stays in `song` is `videoOutputs.ts`, which edits the GRAPH rather than the picture, and `isVideoProject`, a folder probe `surfaces.ts` needs — the two edges that would otherwise make this a cycle), `song-strudel` (Strudel patterns over a song, and the clock that streams them onto engine tracks — split out so the three `@strudel/*` packages are pulled in by what PLAYS a pattern, the file service, and not by every screen that reads a song file), `commands` (one verb list for every surface — the dispatch and the document edits), `audio-probe` (MEASURING decoded audio: the trim gate and the envelope + beat grid. No `node:`, so a BROWSER may have it — st0's clip panel needs no node package for 69 lines of arithmetic), `take-render` (audio a song PRODUCES: filing a take, rendering a mixdown, reading a wav's length), `audio-passes` (the offline passes a chain runs — process, peak, cold; the RUNNING is handed in by the host, `docs/processChain.md`), `translator` (`.dawproject` import), `dsp` (write a module's DSP in JS) |
| the engine | `engine-protocol` (the wire, mirrored in C++), `engine-client` (Node), `engine-browser` (browser + React store; its `access` subpath is the ONE way an app reaches an engine — routes, probe, policy, lease, bound to that service's prefix), `engine-host` (the supervisor — a **program**, not a library), `engine-registry` (which engines exist; each service holds its own registry INSTANCE — one shared implementation, `createRegistry()` per service), `engine-tunnel` (the way IN: the supervisor dials the server that lists it, the server reaches the engine through that socket however far apart they are, a server-owned project plays from a local copy, and a browser gets a WebRTC path straight to the engine's machine — `docs/tunnel.md`, `docs/rtc.md`) |
| the disk | `file-service` (every file operation — st0's backend has none; it runs on the server only, and an engine's machine has none: an engine is shared by the accounts that play on it, and what the server needs of that machine — a stem cut, a set list copied, a file brought down — is a job its supervisor runs over the tunnel, `packages/engine-tunnel/docs/jobs.md`), `file-hub` (starts that file service inside pl8, one process per account: the only place workspaces live, under `$STUDIO_FILES_ROOT`, without which pl8 refuses to start — `docs/fileHub.md`), `stem-separation` (splitting a mix: the ONNX model, its worker thread, the job registry — split out so `onnxruntime-node`, the one NATIVE dependency in the tray's bundle closure, sits behind one package; `docs/stemSplit.md`), `mediatek` (the media library), `user-prefs`, `git-repos` (the SSH URI vocabulary and the deploy key) |
| the views | `project-shell` (what an app needs BEFORE it can draw: the launch parameters, the file-service transport, the repository → workspace resolution, the gate — st0 and z0's editor mount the same one — and when a session goes to sleep, `docs/idle.md`), `ui-chains` + `ui-chains-react` (the chains graph — **st0 is the only host**; the desk had its own `chains.tsx`, mounted by nobody, and it was deleted — `docs/inventaire.md` §6), `ui-editor` (YAML + note grids, and the autosave every text pane runs on,
`docs/autosave.md`), `ui-eyes` (WebGL video — st0's `viewport` surface), `ui-timeline` (what an arrangement surface needs whatever its unit is: wheel zoom, middle-drag pan, a ruler's tick chooser, the lane geometry — st0's ruler reads bars OR seconds, since one grid draws a song and its picture), `ui-waveform`, `ui-module-builder` (st0 and pl8), `ui-app-switch` (the way OUT of an app and into the others of the origin — st0's home page and pl8's header mount the same menu), `ui-mini-player` (the transport BAR at the bottom of an app — play/pause, a scrubber, a close, and no transport of its own: pl8's médiathèque and st0's reference tracks mount the same row, `docs/miniPlayer.md`); the `ui-turntables` PACKAGE is gone — its desk moved into `st0-plugins` (the sdk row below), the one place that imported it |
GESTURE against a running engine — `put-on.ts` is what costs a record its place on a deck) |
| the types | `web-protocol`, `graph-model` (split out so drawing a graph doesn't drag in auth) |
| the sdk | `st0-sdk` (the `St0Plugin` contract and the installers — a plugin is a set of commands, a surface, a set of modules, `docs/sdk.md`), `st0-plugins` (st0's builtin plugins and the two composition lists: the file-service installs the server half at boot, the shell registers the browser half into its pane ring — and it ABSORBED the DJ desk: `src/turntables/` is the desk's whole code, `docs/turntables/` its rationale, `scripts/turntables/` the harness that measures a SOUND; `src/video/` is the viewport's, on the same pattern) |
| z0 | `player-web` — the blind-test player, with a moteur-backed seam behind it |

Two of these are **processes rather than libraries**, started rather than imported:
`file-service` (`bin: studio-file-service`), which `@studio/file-hub` runs inside pl8, one process
per account, and `engine-host` (`src/main.ts` under the tray, `bin: studio-engine` for a terminal —
one supervisor, two front ends), esbuilt into the tray by `engine/st0-tray/scripts/build-engine.mjs`.

They are named `@studio/*` rather than `@st0/*` because st0 is only one of
their consumers: `apps/pl8` drives them too, and z0's moteur-backed player sits
behind the seam `@studio/player-web` provides.

**In production the four apps above are ONE image**, `docker/` — st0 at the
origin root, pl8, k7 and z0 under their prefixes, four backends beside one nginx that owns
the path routing. Same shape as phare's monolith, and for the same reason: they share a
hostname and a session cookie, so four images would only mean the edge holds a path table
that belongs next to the apps. `engine/st0-engine` and `engine/st0-tray` are not in it and never
will be — they run on the musician's machine.
`docs/versioning.md` is the page, including what one container costs.

Notes for the whole repo — CI, deployment, the dev session — are in `docs/`:
[dev.md](docs/dev.md) (what `npm run dev` starts), [versioning.md](docs/versioning.md) (the
hosted image's stamp), [desktop-release.md](docs/desktop-release.md) (the OTHER half — the
packaged app for the three desktops, a rolling snapshot off master and a release per `vX.Y.Z`
tag, and the one workflow that compiles the C++ engine),
and four plan/recipe pages, [platter-plan.md](docs/platter-plan.md) (the DJ deck's
playback: a stretcher inside the platter, and the hybrid it deletes),
[platter-node-plan.md](docs/platter-node-plan.md) (its sequel — the platter is injected into the
document rather than declared, and the engine already accepts a declared one),
[key-detection-plan.md](docs/key-detection-plan.md) (the desk detects no key: what a chromagram
would cost in the C++ analysis pass — measured — and the ground truth it still lacks),
[module-builder-plan.md](docs/module-builder-plan.md) and
[rename-test-plan.md](docs/rename-test-plan.md) — the latter is the METHOD for renaming an
app, a service or a protocol prefix: the order of the phases, and the rule that every check
carries its failure signature.
[constat.md](docs/constat.md) is the transversal reading of the audio axis — performance,
stability and dead code in one place, dated and with the commands to replay it. Start there
when you don't yet know which of the four specialised pages you need.
[inventaire.md](docs/inventaire.md) is the standing inventory of dead and duplicated code —
read it before deleting anything that merely *looks* unused. Its TOOL is
`npm run lint:dead` (knip), non-blocking, scoped to the audio axis.

Two other checks guard what no test would: `npm run lint:bytes` refuses a NUL byte in a tracked
source file (ripgrep skips such a file whole, so it stops existing for every sweep), and
**`npm run lint:docs` refuses a `.md` that names a source file which is not there**. That second
one exists because the method of this repo is that the WHY lives in the prose — a page pointing at
a file two renames ago sends the reader into a wall.
[audit-moteur.md](docs/audit-moteur.md) is the standing audit of everything that links a
surface to `engine/st0-engine` — what is shared, what is copied, where the connections give way,
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

# Developing on the Windows machine

**Windows only** — on macOS and Linux everything is simpler: edit and build in the
same world, run `npm run dev`, and none of the following applies.

Development is **native Windows** — no WSL: the tree lives on NTFS, and every npm command, the
MSVC build and the binaries run there. **Editing** (claude, nvim…) happens in the
`console.priv.frediver.se` tabs — Git Bash by default — while
**every build and every dev server belongs to Tilt** (`npm run dev` = `tilt up`, one
resource per server, UI at http://localhost:10350). So never build by hand:
save (or `tilt trigger <resource>`), wait for Tilt to finish, then read
`tilt get uiresources` / `tilt logs <resource>` to see if something is wrong. The
tray is not used in dev: the engine is self-sufficient. See docs/remote.md.

## When you do shell out on the Windows side, do it from a FILE

PowerShell is the wrong tool for anything touching this repo's text, and the failure is silent
rather than loud. Measured here, three times in one session:

- **It corrupts UTF-8.** `Get-Content -Raw` reads as ANSI, so a read-modify-write round trip turns
  `é` into `Ã©` and `—` into `â€"`. It wrecked two commit messages and a source file before anyone
  noticed, because the file still parses and the diff still looks plausible.
- **Accented arguments do not survive the call**, even in single quotes:
  `bash -lc 'echo "é à ç"'` prints `` — the text is lost between PowerShell and the exe.
- `--%` does not save you: it swallows the rest of the line, epilogue included.
- Its parser rejects `&&`, `??`, `?.` and bare `|` in places bash accepts them.

So: **write the script with the file tool, then run `bash script.sh`.** The file tool writes UTF-8
without a BOM, and nothing accented ever passes through PowerShell's argument encoding.

```bash
# .tmp-work.sh — written as a file, then: bash .tmp-work.sh
set -euo pipefail
grep -rn 'médiathèque' packages/song/src | head
```

Use PowerShell only for short ASCII commands where none of the above bites — `git status`,
`npm run test`. **Never for text substitution in a tracked file**: use the edit tool, which is
what every one of those three corruptions should have used.
