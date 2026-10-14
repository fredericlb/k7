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
- **Whenever you edit a js/ts file, make sure it passes biome's lint**

These rules hold in every language here — TypeScript and C++. They are about *where* the
prose lives and *how much* of it sits in the code: this codebase still writes down the **why**,
but a reader scrolling past forty lines of justification to reach a function is paying for it.
The zone's `docs/` directory is where that justification belongs:

| zone | pages live in |
|---|---|
| a shared package | `packages/<pkg>/docs/` |
| the st0 frontend | `apps/st0/frontend/docs/` |
| the médiathèque | `apps/st0/backend/docs/media/` (the routes) and `packages/ui-library/docs/` (the screens) |
| the DJ desk | `packages/st0-plugins/docs/turntables/` |
| the project shell | `packages/project-shell/docs/` |
| the C++ engine | `engine/st0-engine/docs/` |
| the native supervisor | `engine/st0-supervisor/docs/` |
| the Android app | `engine/st0-engine/docs/android.md` |
| the standalone desktop app | `apps/st0-standalone/docs/` |
| the Electron shell under it | `commons/packages/electron-shell/docs/`, and `packages/supervisor-host/docs/` for the supervisor it drives |
| the rehearsal recorder | `packages/rehearsal-server/docs/` (the routes) and `packages/ui-rehearsal/docs/` (the screens) |
| the engine's build scripts | `engine/scripts/docs/` |
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

`studio` holds the music/stage apps. The audio side spans the server and the musician's machine,
which is why this overview lives at the root and not inside any one app. Two processes run on the
musician's machine — `engine/st0-engine` and `engine/st0-supervisor` — either on their own, as the
command-line engine (`st0-supervisor --config <file>`), or inside an app: the desktop app
(`apps/st0-standalone`) or the phone (`engine/st0-android`). They also run on the server, as one more
machine in an image of their own (`docs/server-engine.md`):

| dir | language | what it is |
|---|---|---|
| `engine/st0-engine` | C++ | The audio engine. Receives a compiled `ProjectDoc` over WebSocket, diffs it, plays audio, pushes transport and meter state back. **Never parses song files.** |
| `engine/st0-supervisor` | C++ | The engine machine's **supervisor**: starts, adopts and watches the engine, keeps it listed at the studios it is connected to, holds the tunnel a server reaches the machine through, and runs the work a server asks of the machine — a stem cut, a set list brought down, a file for the player (`docs/supervisor.md`). |
| `engine/scripts` | Node | The scripts that build the engine and the supervisor and package what ships: the command-line engine's archive, and the desktop app's installer around the same binaries (`engine/scripts/docs/buildEngine.md`). |
| `engine/st0-android` | Kotlin (Gradle) | The engine on a PHONE: the same engine as a library the app loads, since JUCE's Android audio reaches Java, and the same supervisor as a program it runs, driven over stdio as the desktop app drives it. STANDALONE like `apps/st0-standalone`: it also runs st0's backend, bundled, under Termux's node, so a phone opens its own studio and needs no server. Foreground only (`engine/st0-engine/docs/android.md`). |
| `apps/st0` | TypeScript | The text-first DAW, and the only app that opens a project: `frontend` (React/Vite) + `backend` (Express — the origin's OIDC flow, which MINTS the session every studio service verifies, the account's preferences, and the **media library** below; one process, `apps/st0/backend/src/server.ts`). Owns the timeline; shares the chains view. **Modules and chains are authored here**, against a project where the plugin a module names is actually LOADED, and written into one of the origin's libraries by an admin, who edits a library live from any project — a library is a plain folder on the server, seeded once from `st0-library/`, which every account reads at once (`packages/song/docs/sharedFolders.md`). A project is created from one of five **archetypes**: three named after the surface they open on — `arrangement` (a timeline), `mix` (two decks and a crossfade — `packages/song/docs/setProject.md`), `video` (a timeline and a viewport) — and the two `live` ones, named after what they ARE: a rig you play THROUGH, with nothing arranged and no lane of any kind — an input, a fader, the master run, and in `live-video` a webcam feeding RENDER plus the one viewport a picture cannot do without (`packages/song/docs/liveProject.md`) — and a song holds **sound and picture** alike: video lanes on the same timeline, whose ruler reads bars or seconds, and a `viewport` surface that composites them (`docs/picture.md`). What it draws beyond its panes, it draws because the project DECLARED it, in `surfaces/` (`docs/surfaces.md`). It opens the account's **playlists** as well — `_playlists/` at the workspace root, listing songs that live in the media library's catalogue, which this app searches and uploads into (`frontend/docs/playlists.md`). A `turntables` surface NAMES one, and that is what the DJ desk's browser lists and what the machine pre-fetches before a gig. Beside those, `_references/` — the finished mixes you listen AGAINST, uploaded there and played by the BROWSER so a reference sounds over a live rig or a running arrangement without going near the engine (`frontend/docs/references.md`). It owns the level above a project too: its **home page** — the ORIGIN with no project in the address — lists the account's workspaces, the projects inside them, the libraries and the published shares (`frontend/docs/projects.md`) — and its left sidebar carries the origin's USER MENU — the account, the other apps, the logout (`packages/ui-user-menu/docs/userMenu.md`). It is the **front door**: it answers the origin root, `st0.app` / `priv.st0.app` (the private instance), and a project is addressed `/@local/<workspace>/<project>` — a folder on the machine that holds it, with `@banc` (the bench, a live rig seeded with a library chain) and `@shares` (a frozen snapshot) the only other openable addresses — plus `/external`, the menu of surfaces a second device drives (`frontend/docs/external.md`). Opened ON one WORKSPACE otherwise, by an address rather than a picker — see `packages/project-shell/docs/launch.md`. A workspace is one folder holding SEVERAL projects: the editor's tree is the whole of it and a ▶ on a project row is what hands that one to the engine (`packages/file-service/docs/activeProject.md`). It is no git repository: it lives on the server and reaches every device through the live-sync relay, which is also where its history will come from (`docs/live-sync-plan.md`). |
| `apps/st0` — the médiathèque | TypeScript | The **media library** — songs, samples, recordings — is st0's too: its routes are mounted inside st0's backend (`apps/st0/backend/src/media/`, `mountMedia`) over a volume of files, and its screens are `@studio/ui-library`, mounted under `/media` with its sections as entries of the home sidebar. It holds **no modules and no chains**: those are authored in the editor, for the reason above. It DOES hold **playlists**, under `playlists/` on the volume and with a section of their own — a root zone rather than a family, since a set list names songs and carries no bytes (`packages/ui-library/docs/playlists.md`). A workspace keeps its own under `_playlists/`, in the same format and for a different job: those are versioned with the songs they were written for, and are the ones a `turntables` surface can name (`packages/song/docs/playlists.md`). The same backend holds the published shares (`/api/shares`), the engine registry (`@studio/engine-registry`), and — through `@studio/file-hub` — the accounts' WORKSPACES, one file service per account. `play.st0.app` is a permanent ALIAS of st0's origin — installed supervisors and sent share links name it — answering `/api/*` and sending every page to `/media/…` (`packages/web-protocol/docs/addresses.md`); "pl8" survives only as the library's identifier (its engine session, its registry's endpoint file). |
| `apps/st0` — the rehearsal recorder | TypeScript | The **rehearsal recorder** — sessions and their takes, releases and the public pages that list them, a shared songbook with tablature, scores and timed lyrics, singing exercises and a tuner — is st0's as well: its routes are `@studio/rehearsal-server`, mounted inside st0's backend BEFORE the media library (`mountRehearsal`), over a SQLite store of its own for the rows and the sheets (`packages/rehearsal-server/docs/store.md`) and the media library for every recording's bytes (`packages/rehearsal-server/docs/audio.md`); its screens are `@studio/ui-rehearsal`, mounted under `/rehearsal` with a **Rehearsal** group in the home sidebar, and a take is held ABOVE the home's routes so it survives moving between pages (`packages/ui-rehearsal/docs/sections.md`). A public page, `/rehearsal/@<nametag>`, is read before the sign-in gate. `k7.st0.app` is a permanent ALIAS of st0's origin — saved publish URLs and tokens, public page links and installed PWAs name it — answering `/api/*` and `/rtc` and sending every page to `/rehearsal/…` (`packages/ui-rehearsal/docs/routing.md`); "k7" survives as the identifier of the publish feature (`project share k7`), of the `K7_*` keys and of the `k7-data` volume. |
| z0 | — | The blind-test game lives in its own repository. It consumes four packages of this one by version — `web-protocol`, `engine-protocol`, `engine-browser`, `project-shell` (`docs/publishing.md`) — and is deployed from `docker/docker-compose.yml`, at `/z0` on st0's hostname. |
| `apps/st0-standalone` | TypeScript (Electron) | st0 — the editor and the media library — as a desktop app: its one backend runs with Electron as its node — packaged, as the same bundle and from the same table as the phone (`apps/st0/backend/docs/standalone.md`), and Electron rather than Tauri or Capacitor for the reasons in its `docs/standalone.md` — the account file services with it, the supervisor and its engine beside them, and a window on st0 at `127.0.0.1:18789`. Dev-stub sign-in, a local library seeded on first run; its own ports, published as `STUDIO_PORTS`, so it runs beside `npm run dev` (`apps/st0-standalone/docs/standalone.md`). |

`packages/` is **studio's own shared tier**. All are `@studio/*` and are consumed
as **raw TypeScript source**: no build step, imported through `package.json`
`exports` subpaths, so a bare deep import fails on purpose.

| group | packages |
|---|---|
| the song | `song-schema` (the FILE FORMAT and the value vocabulary around it — one zod schema and one reader/writer per kind of YAML file, plus `timecode`, `moduleTypes`, `playlist`, `stems`… Nothing in it touches `node:fs`, which is the whole point: **this is the half a browser may import**, and st0's frontend, `ui-library`, `ui-editor`, `ui-module-builder`, `st0-plugins` (the desk) and `project-shell` depend on it INSTEAD of on `song`), `song-edit` (CHANGING a project rather than compiling one — params, assets, events, material, time; every write goes through a YAML writer that changes the value and nothing else, so a knob drag stays a one-line diff), `song` (folder of YAML → `ProjectDoc` + `GraphDoc` — the compile, the loader and every disk walk, and only READING; a project is one of three SHAPES, `docs/setProject.md`; it also owns the WORKSPACE's shape around a project — the shared folders, the account's libraries and their third family `assemblies/`, and the `assemblies/` a project draws its nodes as BOXES with, `docs/assemblies.md`, and `_playlists/`, `docs/playlists.md`), `song-video` (the SAME folder → `VideoProjectDoc` for its picture — the video document model, the lane and chain compile, the shaders; `packages/song-video/docs/picture.md`. Split out because a song's sound compiles without any of it; what stays in `song` is `videoOutputs.ts`, which edits the GRAPH rather than the picture, and `isVideoProject`, a folder probe `surfaces.ts` needs — the two edges that would otherwise make this a cycle), `song-strudel` (the Strudel side of a pattern lane — the hap → event mapping and the API the ENGINE runs, bundled into `engine/st0-engine` and tested here under Node; nothing imports it at run time, since the engine plays every pattern lane, `engine/st0-engine/docs/patternPlugin.md`), `commands` (one verb list for every surface — the dispatch and the document edits), `audio-probe` (MEASURING decoded audio: the trim gate and the envelope + beat grid. No `node:`, so a BROWSER may have it — st0's clip panel needs no node package for 69 lines of arithmetic), `take-render` (audio a song PRODUCES: filing a take, rendering a mixdown, reading a wav's length), `audio-passes` (the offline passes a chain runs — process, peak, cold; the RUNNING is handed in by the host, `docs/processChain.md`), `translator` (`.dawproject` import), `dsp` (write a module's DSP in JS) |
| the engine | `engine-protocol` (the wire, mirrored in C++), `engine-client` (Node), `engine-browser` (browser + React store; its `access` subpath is the ONE way an app reaches an engine — routes, probe, policy, lease, bound to that service's prefix), `engine-registry` (which engines exist — ONE registry for the studio, mounted by st0's backend, `docs/shared.md`), `engine-tunnel` (the way IN: the supervisor dials the server that lists it — the hub here, the machine's agent in `engine/st0-supervisor` with `agent.ts` its TypeScript reference — the server reaches the engine through that socket however far apart they are, a server-owned project plays from a local copy, and a browser gets a WebRTC path straight to the engine's machine — `docs/tunnel.md`, `docs/rtc.md`) |
| the disk | `file-service` (every file operation — st0's backend has none; it runs on the server only, and an engine's machine has none: an engine is shared by the accounts that play on it, and what the server needs of that machine — a stem cut, a set list copied, a file brought down — is a job its supervisor runs over the tunnel, `packages/engine-tunnel/docs/jobs.md`), `file-hub` (starts that file service from st0's backend, one process per account: the only place workspaces live, under `$STUDIO_FILES_ROOT`, without which the backend refuses to start — `docs/fileHub.md`), `stem-separation` (the seam a stem cut is handed through to the engine's machine, and the id that keys a job by its work; the cut itself runs in `engine/st0-supervisor`; `docs/stemSplit.md`), `mediatek` (the media library), `user-prefs`, `live-sync` (a workspace edit as an OPERATION — values set at YAML key paths, sent only when they replay a file byte for byte, the whole text otherwise — and the ORDER replicas apply them in: the server's room, and each replica's own pending edits replayed over it; no `node:`, `docs/ops.md`, `docs/sync.md`, and the plan it starts is `docs/live-sync-plan.md`) |
| the views | `project-shell` (what an app needs BEFORE it can draw: the launch parameters, the file-service transport, the address → workspace resolution, the gate — st0 mounts it, and z0's editor consumes the published package — and when a session goes to sleep, `docs/idle.md`), `ui-chains` + `ui-chains-react` (the chains graph — **st0 is the only host**; the desk had its own `chains.tsx`, mounted by nobody, and it was deleted — `docs/inventaire.md` §6), `ui-editor` (YAML + note grids, and the autosave every text pane runs on,
`docs/autosave.md`), `ui-eyes` (WebGL video — st0's `viewport` surface), `ui-timeline` (what an arrangement surface needs whatever its unit is: wheel zoom, middle-drag pan, a ruler's tick chooser, the lane geometry — st0's ruler reads bars OR seconds, since one grid draws a song and its picture), `ui-waveform`, `ui-module-builder` (st0), `ui-user-menu` (the top-right menu of an app: who is signed in, the way OUT and into the others of the origin, the logout — `@frediverse/ui/user-menu` with the origin's table of apps; st0's home sidebar mounts it), `ui-mini-player` (the transport BAR at the bottom of an app — play/pause, a scrubber, a close, and no transport of its own: the médiathèque and st0's reference tracks mount the same row, `docs/miniPlayer.md`), `ui-library` (the médiathèque's screens — songs, samples, recordings, playlists, the hunt — with no page of their own: st0 mounts them under `/media` and hands in the API base, the labels and the route prefix, `docs/host.md`); the `ui-turntables` PACKAGE is gone — its desk moved into `st0-plugins` (the sdk row below), the one place that imported it |
GESTURE against a running engine — `put-on.ts` is what costs a record its place on a deck) |
| the types | `web-protocol`, `graph-model` (split out so drawing a graph doesn't drag in auth) |
| the desktop | `supervisor-host` (`engine/st0-supervisor` as the child of an Electron app: spawned and kept running, its NDJSON frames, its binaries staged into the app — `docs/supervisorHost.md`). The rest of a desktop app on Electron — the hosted servers run unchanged under Electron-as-node and dying with it, the window and its link policy, the quit sequence, the build and packaging base — is `@frediverse/electron-shell`, in `commons/` because phare will build on it too (`commons/packages/electron-shell/docs/shell.md`) |
| the sdk | `st0-sdk` (the `St0Plugin` contract and the installers — a plugin is a set of commands, a surface, a set of modules, `docs/sdk.md`), `st0-plugins` (st0's builtin plugins and the two composition lists: the file-service installs the server half at boot, the shell registers the browser half into its pane ring — and it ABSORBED the DJ desk: `src/turntables/` is the desk's whole code, `docs/turntables/` its rationale, `scripts/turntables/` the harness that measures a SOUND; `src/video/` is the viewport's, on the same pattern) |
| the rehearsal recorder | `rehearsal-server` (its routes, mounted by st0's backend, with a hand-written `.d.ts` because its store is untyped), `ui-rehearsal` (its screens and their own paraglide catalogue, mounted by st0 under `/rehearsal`), `rehearsal-shared` (the types and rules both halves read — a page's version, a sheet's kind, the EPUB), `recorder` (taking a take in the browser, `docs/recorder.md`), `score` (MusicXML and Guitar Pro through alphaTab), `lyrics` (chords and timed lyrics in a sheet), `tablature` |

One of these is a **process rather than a library**, started rather than imported:
`file-service` (`bin: studio-file-service`), which `@studio/file-hub` runs from st0's backend, one
process per account.

They are named `@studio/*` rather than `@st0/*` because st0 is only one of
their consumers: z0 consumes four of them from another repository. Those four — `web-protocol`,
`engine-protocol`, `engine-browser` and `project-shell` — are the only ones PUBLISHED, by version and
still as raw TypeScript (`docs/publishing.md`); every other package stays private to this tree.

**In production the hosted apps are TWO images** (`docker/docker-compose.yml`): st0 (the
editor, the media library and the rehearsal recorder), built here, one Node process serving its own
built frontend with no nginx, reached at the root domain and on the `play.` and `k7.` aliases; and
z0, built by its own repository and only deployed here, one image with nginx inside, reached by a
`/z0` path on st0's hostname. The rehearsal recorder's store is a SQLite file on st0's `k7-data`
volume, not a container. One session covers them through the shared
`COOKIE_DOMAIN`, and each ships and restarts on its own. `engine/st0-engine` and
`engine/st0-supervisor` are in none of them: the server's own engine is a fourth container,
`st0-engine`, built here from `engine/docker/Dockerfile`, which reaches st0 through the tunnel
like any musician's machine, plays into a null sink, and makes the renders st0's image has no
engine binary for (`docs/server-engine.md`). `apps/st0-standalone`
and `engine/st0-android` run on the musician's devices only. `docs/versioning.md` is the page.

Notes for the whole repo — CI, deployment, the dev session — are in `docs/`:
[dev.md](docs/dev.md) (what `npm run dev` starts), [versioning.md](docs/versioning.md) (the
hosted image's stamp), [images.md](docs/images.md) (why st0's Dockerfile is staged the way it is),
[server-engine.md](docs/server-engine.md) (the server's own engine: its image, its null-sink device),
[publishing.md](docs/publishing.md) (the four packages z0 consumes by version), [desktop-release.md](docs/desktop-release.md) (the OTHER half — the
packaged app for the three desktops, a rolling snapshot off `main` and a release per `vX.Y.Z`
tag, and the one workflow that compiles the C++ engine),
and four plan/recipe pages, [platter-plan.md](docs/platter-plan.md) (the DJ deck's
playback: a stretcher inside the platter, and the hybrid it deletes),
[platter-node-plan.md](docs/platter-node-plan.md) (its sequel — the platter is injected into the
document rather than declared, and the engine already accepts a declared one),
[key-detection-plan.md](docs/key-detection-plan.md) (the desk detects no key: what a chromagram
would cost in the C++ analysis pass — measured — and the ground truth it still lacks),
[module-builder-plan.md](docs/module-builder-plan.md),
[live-sync-plan.md](docs/live-sync-plan.md) (an edit reaches every replica — the server, a desktop,
a phone — as an operation the server orders, whose log is the only history) and
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

`npm run lint:panels` checks every library panel's `bind:` against the parameters its plugin really
exposes to the engine, since a bind the plugin does not have is a control that moves and does nothing
(`packages/song/docs/panelBinds.md`). It instantiates each external plugin, so it runs only on a machine
where they are installed, and it is not part of `npm run lint`.

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

`st0-library/` is a plain folder of this repository: the `@st0` modules library, the SEED the server
copies a library folder from once and the desktop and phone bundles carry a copy of. It is here so
a module and the code it relies on change together, in one commit. Its binaries (IRs, amp models,
presets) are ordinary tracked files; a path in it stays short, since a Windows checkout refuses one
past 260 characters.

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
engine runs as the command-line engine under the `native` resource. See docs/remote.md.

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
