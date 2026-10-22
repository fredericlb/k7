# AGENTS.md — k7

A **text-based DAW**. Your song is a folder of k7x files; the terminal or a web editor
is your studio.

**This directory is the web editor, and only that.** The engine (`engine/k7-runtime`), its
supervisor (`engine/k7-supervisor`) and the brain packages (`packages/*`, all `@studio/*`) sit beside it
rather than inside it, because they serve every audio app in the repo — the repo-root
`AGENTS.md` holds the map of the whole audio side. Two workspaces live here:

| Package | Role |
|---|---|
| `frontend` (`k7-frontend`) | React + Vite + Tailwind v4 + `@frediverse/ui`. The visual editor: k7x code editor (CodeMirror), timeline, chains graph. |
| `backend` (`k7-backend`) | Express — **the origin's OIDC flow, the account's preferences, the media library and the rehearsal recorder**: it MINTS the `studio.sid` every studio service verifies, being the service with no path prefix, it mounts the rehearsal routes (`@studio/rehearsal-server`, `packages/rehearsal-server/docs/`), and it mounts the médiathèque (`src/media/`, `docs/media/`) — the catalogue, the shares, the hunt, THE engine registry and the file hub that starts each account's file service. It has no file routes of its own: every file operation is the file service's. |

Dev ports: **frontend 5223, backend 8789**, served over TLS at `https://app.priv.k7.rocks`
by the LAN reverse proxy — and at `https://docs.priv.k7.rocks`, the documentation alone, as the
hosted k7 answers `docs.k7.rocks` (`frontend/docs/docsSite.md`,
`packages/web-protocol/docs/addresses.md`).

The médiathèque's screens are `@studio/ui-library`, mounted at `/media/*`
(`frontend/src/projects/MediaPage.tsx`, `packages/ui-library/docs/host.md`); its sections are
entries of the home sidebar. The rehearsal recorder's screens are `@studio/ui-rehearsal`, mounted
at `/rehearsal/*` the same way (`frontend/src/projects/RehearsalPage.tsx`, `RehearsalHost.tsx`),
with a take held above every home route and a public page read before `AuthGate`
(`packages/ui-rehearsal/docs/routing.md`).

## The browser talks to THREE servers

| | `backend` | `@studio/file-service` | `engine/k7-runtime` |
|---|---|---|---|
| runs on | the hosted machine | the hosted machine, one process per account behind this backend's file hub | the engine's machine |
| owns | `/auth/*` for the whole origin, the preferences, the media library, the rehearsal routes and the engine registry | the account's workspaces — every file op | audio playback |
| reached | same-origin (`/api`, `/auth` via the Vite proxy) | **through this backend's `/api/files`, never directly** | **WebSocket — direct when the browser may, else relayed through this origin** |
| auth | session cookie (`studio.sid`) | a ticket the hub mints from the session | engine token echoed on `whoami` |

**The backend has no file routes and no `store.ts`.** Every file operation lives in
`packages/file-service/src/workspace.ts`. Don't look for `tree`/`read`/`write`/`fmt`
here.

The file service does **not** see the session cookie, or any header a page chose: the hub turns the
session into a ticket, stamps the user itself, and the service answers only the hub's secret
(`packages/file-hub/docs/fileHub.md`).

`AuthGate` → `EngineGate` → `ProjectGate` → editor, when the address names a project.
When it names none, `main.tsx` mounts `AuthGate` → `Home` instead — the projects page, which
needs the account and neither an engine nor a project (`frontend/docs/projects.md`). One address
short-circuits both: `/external`, the menu of surfaces a second device can drive — every surface
of the project the ENGINE is holding, which `GET /engine/served` answers and which is not the same
question as each workspace's active-project marker. It is `AuthGate` → `ExternalIndex` and probes
for a machine without claiming one (`frontend/docs/external.md`). It is read BEFORE `parseLaunch`, since a single segment is
otherwise a workspace — so `external` is a reserved short name. The engine
picker is unreachable until logged in either way. Auth falls back to a "Dev User" stub when no
`OIDC_*` env is set, but login is still mandatory.

**`/auth/*` is THIS backend's.** k7 answers the origin root (`app.priv.k7.rocks`, `app.k7.rocks`), the
docs host and the former `st0.app` hosts (`packages/web-protocol/docs/addresses.md`).
There is one session cookie — `studio.sid`, signed with the `SESSION_SECRET` in `env.yaml`'s
`common` and scoped to the shared `COOKIE_DOMAIN` so every subdomain receives it — and one
`redirect_uri` to register with the IdP: `<k7 origin>/auth/callback`. So the flow is k7's: another
service on the domain passes `mountRoutes: []` and merely verifies the cookie, and a page on a
sibling subdomain sends the browser to `authOrigin(origin)` to sign in. The rehearsal routes (`@studio/rehearsal-server`) are
mounted in this process and take its `requireAuth`.

Spell this app's auth calls BARE (`/auth/me`), never under `BASE` — here the two coincide, for
every other app they do not.

Two consequences to know: logging out anywhere logs you out of every studio service, and
**this backend being down means nobody can log into any studio service** — each will show its
own 401, which does not say so.

## Frontend architecture

The long-form rationale lives in `frontend/docs/`, one page per area — read the one that
matches before changing it:

| page | covers |
|---|---|
| `projects.md` | the HOME page — `/` with no project in it: the workspaces, the libraries, the shares |
| `icons.md` | the app icon: one SVG, rendered into every platform's icon by `scripts/icons.mjs` |
| `about.md` | `/about` — the version, the GPLv3, the source link the AGPL asks for, and the third-party notices built from the tree |
| `playlists.md` | the cog's Playlists screen — `_playlists/` in the workspace, over the media library's song catalogue |
| `references.md` | `_references/` — what you listen against, played by the browser beside whatever the engine is doing |
| `tasks.md` | `TODOS.md` at the workspace root — the task list panel, a Markdown checklist written through `task` commands |
| `shell.md` | `App.tsx`/`main.tsx`, the gate stack, the palette |
| `state.md` | what lives in the shell store and the query cache, and what stays local state |
| `shellRouting.md` | `routes.ts` + `useViewRoute.ts` — view / full / panel against the URL |
| `chainsGraph.md` | the chains renderer and its camera rules |
| `timeline.md` | the keyboard-driven arrangement view |
| `playhead.md` | why the playhead is steered by the engine's frames rather than drawn from them |
| `picture.md` | video lanes on that same timeline, the ruler's two units, the viewport surface |
| `clipEditors.md` | the piano roll and the waveform over one event — and the loop marks they share |
| `masterMeter.md` | the header's meter, what it holds across a pass, and the Fix button's trim |
| `mastering.md` | the `mastering` surface — one quick-master node as three appliances, and why nothing on it normalises |
| `commandBar.md` | the step-by-step palette and module picker |
| `curveEditor.md` | `ui curve` — the popin that creates and edits an automation curve |
| `moduleBuilder.md` | the shared builder — and why its parameter list comes from the OPEN project |
| `sharedModules.md` | the file tree's Libraries tab: editing a `@k7-core` module in place |
| `conflicts.md` | the sync relay's change notices, the `/revision` fallback, and the open conflicts settled from the footer |
| `shared.md` | the OTHER shared: `/@shares/<token>.k7` — this app opened on a project at a checkpoint, played by the server's engine in the visitor's own session, with no account and no source |
| `external.md` | `/@external/<surface>` — one surface alone on a second device, and `/external`, the menu it starts from |
| `pairing.md` | a LAN device asking an engine to trust it — the card on the device, the prompt and the settings section on the machine |
| `contextMenu.md` | the right-click menu, derived from the command catalogue |
| `midi.md` | playing a module's params from a MIDI controller |
| `docExamples.md` | how `docs.test.ts` keeps the shipped documentation honest |
| `docsSite.md` | `docs.<domain>` — the same documentation on a host of its own, with no account and no engine |
| `audit.md` | the standing stability and speed audit — what the app holds, and the lots still open |

### Three data paths (`src/api.ts`)

1. **Backend** (same-origin `/api/*` and `/auth/*`, both at the origin root since k7 answers
   it) — the OIDC flow, the preferences, the media library and the engine registry, the last
   reached through `api.ts`'s `engines` (`@studio/engine-browser/access`, which also owns
   the probe, the policy and the lease). Don't spell those routes here again.
2. **File service** (absolute URL) — everything file-shaped (`/tree`, `/file`, `/hints`,
   `/command`, the compiled `/project-doc` and `/graph`). Bare paths, no `/api` prefix. The
   base comes from the PROBE and is set once by `ProjectGate`: direct to the machine when
   the browser is allowed one, otherwise this origin's relay. Never build it yourself.
3. **Engine WebSocket** (`@studio/engine-browser`, wired by `src/hooks/useEngineLink.ts`) —
   live transport and meters. Don't route transport through either server.

### Layout: panes, not tabs

`App.tsx` shows **one pane at a time, as a full page** — the timeline, the desk, the strip, the
graph or the editor, with the frame floating over them — and **never splits two of them**. `full` is that page, and it is
never empty: with nothing chosen it is the project's home page, the timeline when declared and
otherwise the first pane the project does declare. The header's pane buttons pick the page and
light the one on screen; the one way to see a second view at the same time is the footer's bottom
panel (`event`, `graph`, `mix`, `logs`). The EDITOR is never the home page — it is shown deliberately (`ui editor`)
or arrives as a popin when a command sends it to a file (`frontend/docs/shell.md`). Every pane is
**mounted exactly once and never unmounted**; `hidden` takes it off screen, which is what lets the
editor be restyled into a popin without losing its undo history, and what keeps the viewport's GL
context alive while you are looking elsewhere.

**A note is a MODULE, not a panel.** Neither a module nor a track takes a `docs:` or `todos:`
field, and both schemas are `.strict()`, so a file still holding one refuses to load. A note is a
node of the built-in `@meta/doc`: one input, no output, one field (`content`), drawn as written
on the graph and wired from whatever it is about. Off by default; the note button sits in the
footer beside the mixer. Read `packages/song/docs/docModules.md`.

**A project declares its SURFACES.** A `surfaces/` folder, one file per special view — `type`,
`layout`, and a `mapping` saying which module each of its components moves. Four types, and the
PAIR is validated:

| type | layout | what it is |
|---|---|---|
| `timeline` | `split` | the arrangement — a pane, and the reason a song draws one at all |
| `viewport` | `floating` | the frame: the song's video lanes composited by `@studio/ui-eyes`, in a window over the pages |
| `turntables` | `split` | the DJ desk, from `packages/k7-plugins/src/turntables` — what makes a project a SET |
| `mastering` | `split` | the master strip: ONE `quick-master` node drawn as its three parts (`frontend/docs/mastering.md`) |

**Every `split` surface is a PANE**, in the layout and in the pane ring. The viewport is the
exception: a WINDOW over whichever page is up, moved and sized by hand, its place kept per browser
— a picture is watched while you edit what draws it. Hidden, never unmounted, since it owns a GL
context and a `<video>` per layer. A set, declaring no timeline, opens
on its desk, and a fader there is a param on a module in the graph — which the bottom panel's
`graph` shows under it.

> `view` is a word in the `layout` enum and nothing draws in it: a file that says it is
> refused by name rather than by "invalid enum value". A project on disk needs the one-word edit
> to `split`.

**A surface is MOUNTED for as long as the project declares it**; only the drawing is conditional,
which is the ordinary pane invariant (`hidden`, never unmounted). A desk's document — the loaded
songs, the crossfader, the six EQ knobs — is not its screen, and a set does not stop existing
because you went to look at the graph. Being a pane is what spares `SurfaceTab` a split of its
own between the hooks and the screen. Get it wrong and the crossfader re-centres on every round
trip while the sound stays where you put it — see `packages/k7-plugins/docs/turntables/deckSet.md`.

A component with no mapping is reported on the surface itself, not by refusing the project.
Read `packages/song/docs/surfaces.md`.

**There is ONE layout, and nobody chooses it either.** Which panes it holds is what the open
project DECLARES: `viewPanes` in `src/routes.ts` takes the surface flags and answers with the
pane ring and the fullscreen list, and that one list closes the header buttons, the number keys,
`ui <pane>` and the mobile tabs together. A project with no `surfaces/timeline.k7x` draws no
timeline, and the transport and the minimap go with it.

`project.k7x` has no `project_type` and there is no `View` type: `surfaces/` answers the same
question and is the only thing that answers it, so two sources cannot contradict. Read
`packages/song/docs/surfaces.md` before touching any of it.

The vocabulary is two words, and `src/routes.ts` is where they are declared —
read it before changing layout. A **pane** is one of five (`editor | timeline | turntables |
mastering | chains`) and is what `full` fullscreens; three of them — `timeline`, `turntables` and
`mastering` — are mounted only when the project declares the matching surface. A **panel** is one of four (`event | graph | mix | logs`) and is what
the bottom of the window shows, under the page, opening on half its height; `mix` is the graph with
every mixer strip lined up on one rank. While a panel is open the timeline's lanes are folded and
Expand is dead. A clip's CONTENTS are the `event` panel's, opened by a double-click on it. Both are URL state (`src/useViewRoute.ts`); see
`frontend/docs/shellRouting.md`.

### Commands are the CLI's, verbatim

The command bar calls `/complete` and `/command` on the **file service**
(`packages/file-service/src/routes/files.ts`), which dispatch through `@studio/commands`.
That package owns the SID → handler mapping and is the only place a verb is defined. Add a
feature there, not here. Web-local commands (`LOCAL_COMMANDS` in `palette.ts`) are what only
a browser can do: the shell's view state under `ui`, plus the bare-named ones that write
through a route rather than through a verb — the file tree's own actions, the mixdown, the
k7 publish, the undo journal.

**Every action on screen is one of them.** No button, menu entry or toggle in this shell is
unreachable from the command bar; where a button and a command would be two copies of one
behaviour, the button dispatches the command. `frontend/docs/shell.md` has the table, and
what is deliberately left out (disclosure, a dialog's own buttons, continuous gestures).

### Every shortcut names a command (`src/keys.ts`)

Keys are looked up in `KEYS` and the named command runs through `runCommand`. `;`
focuses the command bar (`@command`). Bindings can be conditional, ordered, and
interpolate conditions into command names (`f` → `{focus_pane}`).

### Editor, chains, timeline

- **Editor** — `@uiw/react-codemirror` with `@studio/ui-editor` for k7x support and a
  hint-driven completion source. Vim mode is on by default (a global preference in
  `<state>/preferences.yaml`). **There is no Save button here**: the buffer is written as soon
  as it is a document the compiler could read, and held back with the reason while it is not
  (`@studio/ui-editor/autosave`, whose `docs/autosave.md` is the page to read first). The MODULE
  BUILDER is the one screen that does have one — see Modules below. `:w` and
  Ctrl+S mean "now", not "at all" — they flush the timer and cannot overrule the rule.
- **Modules** — `@studio/ui-module-builder`, drawn in the EDITOR's
  place beside the file tree, the editor fullscreened for it — so the next module is one click
  away (`frontend/docs/moduleBuilder.md`). A module row in the tree opens it on the panel, and so
  do the **Builder** button on a module file's toolbar and `ui builder <module>`.
  `src/api.ts`'s `moduleStore` is the seam — see that package's `docs/store.md`, in particular
  why a save can come back saying it landed somewhere else — an `@engine` ref materialising into
  its first folder, the one case that still redirects.

  **The builder is one of the two screens here with a Save button**, and the exception is
  deliberate: a module is four files describing one thing, and they are only coherent together.
  Ctrl+S and `:w` mean that button, and they save all four files, not the pane you are looking at. `useAutosave`'s `manual`
  mode is what turns the timer off while keeping its validation and its held-back buffers.

  The other is the **Commands settings page**, and for a different reason: what it edits is one
  account-wide document held at the root of the app, so a write-through was a round trip *and* a
  re-render of the whole shell per keystroke (`frontend/docs/shell.md`).

  The file tree has a **second tab, Libraries**, listing every level a module can live at —
  `@workspace`, each of the origin's libraries (`@k7-core`, `@drums`…), `@engine` — nearest first,
  which is precedence. They come
  from `GET /module-libraries`, NOT from `/tree`: that one is rooted at the active project and
  excludes the shared folders on purpose — a project keeps no `modules/` of its own to exclude.
  `@engine` is read-only and has no folder at all (it is the plugin scan, synthesised); the
  others offer **New folder…** and **New module…**. A library module opens the same builder,
  but **a library is written only by an admin**, from any project; for anyone else the file
  service refuses the write. For an admin, Save writes into `_libraries/<name>/…`, which is THE
  library's `draft/` on the server; a workspace hears it once it pins the draft or a version
  published from it, and the hub relays it to the library's k7fs room. Nothing forks and no song
  is touched. One store and one path space: the file hub keeps ONE folder of each
  library for the whole origin, seeded from `k7-core`, and the file service answers it at
  the virtual `_libraries/<name>/…` in every workspace (`packages/song/docs/sharedFolders.md`,
  `packages/file-hub/docs/fileHub.md`). `frontend/docs/sharedModules.md` is the page to read; a
  chain's bench, `/@banc/<chain>/live.k7`, is a live RIG kept nowhere that edits no library.

  **k7 will not open a project without a library.** The origin has ONE list, which the admins
  (this backend's `AUTH_ADMIN_GROUPS`) edit on the **Libraries** page, `/libraries`, linked from the home
  page's sidebar, by name: a new library is copied from the seed when the seed holds it, else
  starts empty. `ProjectGate` refuses before it opens anything. See `frontend/docs/projects.md` and `packages/project-shell/docs/launch.md`.
- **Chains** — dagre (`@studio/ui-chains`) for layout, `@studio/ui-chains-react`'s
  `DomChains.tsx` for drawing: HTML nodes over a canvas of signal cables, with an SVG layer
  between them for the labels, the automation arrows and the hit paths. **Never hand-roll
  layout or edge routing.** dagre owns both; the renderer consumes its numbers. Pan/zoom is one
  CSS transform on the `.dgx-world` wrapper — and the cable canvas is deliberately OUTSIDE that
  wrapper, taking the same camera on its 2D context, because a canvas scaled by CSS goes blurry. Both halves live outside this app because the
  médiathèque and the decks draw the same view — see that package's `docs/hosting.md` for
  what a host owes it. k7 is the demanding host: the command bar, context menu and edge
  inserts are optional props the other two pass nothing for.
- **Timeline** — vim-style: `hjkl` movement, `v` for visual selection, `z`/`Shift+z`
  for the zoom stack, `m`/`s` for mute/solo. Neither is a session flag: `m` rewrites the
  lane's BYPASS in `graph.k7x` — a lane is a module, and its mute is that module's bypass —
  and `s` toggles the lane in project.k7x's root `soloed:` list, several at once, resolved by
  the ENGINE (`packages/song/docs/trackModules.md`). Selection
  and zoom are a stack; the innermost entry describes the view. Unlike chains, this one
  stays k7-only.

## The backend in detail

**`server.ts` is the one process**: the OIDC flow, the preferences, the module builder's AI
organize (`aiOrganize.ts`, `aiSettings.ts` — each account's own Claude key, which the browser can
set and never read back, `packages/ui-module-builder/docs/aiOrganize.md`), the alias redirect, the
built SPA, `mountRehearsal` (`@studio/rehearsal-server`, mounted FIRST: the library's catch-all
`/api` guard would otherwise swallow its public pages and its bearer) — and `mountMedia`
(`src/media/mount.ts`), which mounts the media library, the shares,
the hunt, the stems, the host's player, THE engine registry (`@studio/engine-registry`, whose
`docs/shared.md` says why there is one) and the file hub. The rationale for that half is
`backend/docs/media/`, one page per subject. `server.ts` owns SIGTERM and SIGINT: the registry is
mounted with `exitOnSignal: false`, and the stop says its goodbye, stops the account file services,
then drains the requests in flight.
- The Vite dev server proxies BOTH `/api` and `/auth` to this backend (`proxyPaths`), which is
  what makes the dev server usable when visited directly on its port. No other dev server in this
  repository proxies `/auth`; an app developed elsewhere that shares the origin points its own
  proxy back at this port.
- Auth and engine assignment are separate concerns: the assignment ("in use" badge) is
  a per-engine lease **across users**, not per-workspace across tabs.

Two traps in `server.ts` that read as ordinary lines:

**`OIDC_SCOPES` must keep `groups`.** The library admins, and the deletion of a public rehearsal
song, are gated on group membership (`AUTH_ADMIN_GROUPS`). `@frediverse/oidc` defaults to
`openid profile email`, which puts an **empty** groups array in every session and 403s every admin
surface with nothing to explain it. The value comes from `env.yaml`'s `common`, which already reads
`openid profile email groups`. Note also that the code passes `scopes` only when non-empty: the
package falls back on nullish only, so an empty array asks the IdP for *no* scopes rather than for
its defaults.

**The prefs zod schema is the GATE, not a description.** A zod object strips what it does not
declare, so a field the frontend saves and `prefsSchema` does not name would be accepted, answered
`{ok:true}`, and dropped. `preferencesRouter` refuses such a write out loud (`droppedKeys`), but
the rule to remember is that widening `K7Prefs` in the browser is only half of adding a
preference.
`engineId` and not an address, for the same kind of reason: an engine's IP moves between networks
while its identity does not, and storing a URL would pin someone to the network they first logged
in from.

## k7 is opened ON a workspace, and plays ONE of the projects in it

A workspace is one folder and holds **several projects**. The editor's tree is the whole
workspace, and the ▶ on a project row is what hands that one to the engine — `POST /open`, which
writes its active-project marker and switches the session, with no navigation and no remount
(`packages/file-service/docs/activeProject.md`). The address may still name a project, and that
is what it opens ON; a bare `/@local/<workspace>` opens the one last played.

**A workspace is no git repository, and starts EMPTY.** **New workspace** on the home page creates one
with no project; opening it draws the first-project wizard, since the archetype decides what the
screen shows and that is a question better asked where the answer will be looked at. There is
nothing to publish or import: a workspace reaches every replica through the live-sync relay, and a
device joining the relay is how an existing one arrives (`docs/live-sync-plan.md`).

## the HOME page is where a workspace is chosen

**This app does not own workspaces**, and never will: the account's file service on the server
holds every working copy, and the media library keeps no register of them (`apps/k7/backend/docs/media/projects.md`). What
this app owns is the SCREEN above a project, at `/` with nothing after it — the workspaces, the
projects inside them, the libraries and the published shares. `frontend/docs/projects.md` is the
page that says why.

A project is named by an ADDRESS — the workspace, then the project folder inside it:

```
/@local/songs/first.k7
/@local/band/albums/winter.k7/timeline      …with the app's own route following it
```

`ProjectGate` opens that folder on the machine: no lookup and no download — the relay is what
keeps the folder there. Arriving with no project in the address is the home page rather
than an error to redirect away from, and `main.tsx` branches on `parseLaunch` before mounting
anything. There is deliberately no SECOND picker.

**The project is the router's `basename`** (`projectBasename`, read by `src/address.ts`; the router is keyed by it in `appMain.tsx`, so entering or leaving a project loads no page — `frontend/docs/shell.md`), which is why
there is no storage anywhere near it: React Router only writes below its basename, so
`routes.ts` cannot rewrite the project away, and a reload or a pasted link simply re-reads the
address. Hold it in a query string and a session instead, and a tab handed a project that does
not exist can never get out of it. Read
`packages/project-shell/docs/launch.md` before touching any of this.

The gate itself is that package's too, published for apps outside this repository (`docs/publishing.md`); `components/ProjectGate.tsx`
is a wrapper holding this app's wording and what to render once the project is open.

**There is no workspace picker anywhere in this app**, and a folder under
`<state>/workspace/<you>/` is the wrong level to offer a choice at. The home page lists
WORKSPACES, which belong to a person, and the gate resolves an address INTO one.

Identity is the OIDC email, which names the engine SESSION rather than a folder — the workspaces are `<state>/workspace/<workspace>` with nobody underneath (`packages/engine-client/docs/paths.md`) — and the active
project is remembered per-workspace in an active-project marker. There is **no global session
file**; the workspace is the scope.

## Many browsers at once (no lease)

Any number of tabs may drive the same workspace concurrently. Last write wins; each
tab's polls (`workspace`/`project`/`tree` on 2s/700ms intervals) reconcile the view.

Anything gated on "has a file changed" reads the `/revision` token through
`hooks/useRevision.ts`, which asks it **once per tab** however many consumers there are —
never on a timer of its own. A change notice pushed by the sync relay makes it ask at once, and the
timer drops to a 30 s fallback while notices flow (`frontend/docs/conflicts.md`). Two hooks each running their own 2s timer over one route is the same
request twice a second, and every request is real work for whatever sits between the browser and
the service.

## Key conventions

- **The engine never parses song files.** It only receives compiled JSON. Swap this
  frontend for another and the engine is unchanged — which is exactly what the decks do today, on the same binary, over the same protocol.
- **Commands are the single source of truth.** `@studio/commands` owns the SID →
  handler mapping, and both the CLI and the web dispatch through it.
- **Wire shapes live in `@studio/engine-protocol`.** A wire change must also update the
  C++ serialization — verified by running the engine, not by TypeScript.
- **All JS packages are consumed as source.** No build step, run via `tsx`, imported
  through `package.json` `exports` subpaths — bare deep imports fail on purpose.

## Verify

`npm run build` is `vite build && tsc --noEmit` for the frontend; the backend has only
`tsc --noEmit`, run directly. `npm run test` runs vitest over ~12 suites, but they cover
**pure logic only** — routing, path handling, module insertion, drag payloads, the shipped
docs. **Nothing mounts a component.** For any visual or interaction change, run the app and
exercise it in the browser; a green test run says nothing about the shell.

`npm run dev` from here starts the frontend, the backend, the file service and the
supervisor together.

Two silent failure modes live in this directory, both worth knowing before you move a
file:

- `src/index.css`'s `@source` — Tailwind emits **nothing** for a path that doesn't
  exist, without warning. The app still builds and the design-system components render
  unstyled. A path that is simply MISSING from the list fails the same way, and worse: every
  class that package alone uses is dropped while the layout classes it shares with the app
  (`flex`, `w-16`) are generated anyway. Leave out `packages/k7-plugins/src` and the desk's
  strip stands in the right place, correctly spaced, with `fill-muted` and `stroke-foreground`
  undefined — SVG knobs with no fill and no stroke. Present, positioned and invisible, which
  reads as "the control is gone" and sends you looking at the component. **Check the list
  against every package that renders JSX, not one at a time**:

  ```powershell
  Get-ChildItem packages -Directory | Where-Object {
    Get-ChildItem $_.FullName -Recurse -Filter *.tsx -ErrorAction SilentlyContinue
  } | Select-Object Name   # …and compare with the @source lines in src/index.css
  ```

  The cheap proof either way is the built CSS: `npx vite build`, then grep
  `dist/assets/*.css` for a class only that package uses.
- `src/docs/pages.ts`'s `import.meta.glob` — an empty glob leaves `/docs` blank *and*
  makes `docs.test.ts` pass vacuously, because its `it()`s iterate an empty list. Check
  the test **count**, not the exit code.
