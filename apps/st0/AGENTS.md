# AGENTS.md — st0

A **text-based DAW**. Your song is a folder of YAML files; the terminal or a web editor
is your studio.

**This directory is the web editor, and only that.** The engine (`engine/moteur`), the
tray (`apps/st0-desktop`) and the brain packages (`packages/*`, all `@studio/*`) sit beside it
rather than inside it, because they serve every audio app in the repo — the repo-root
`AGENTS.md` holds the map of the whole audio side. Two workspaces live here:

| Package | Role |
|---|---|
| `frontend` (`st0-frontend`) | React + Vite + Tailwind v4 + `@frediverse/ui`. The visual editor: YAML code editor (CodeMirror), timeline, chains graph. |
| `backend` (`st0-backend`) | Express — **the engine registry, and the origin's OIDC flow**: it MINTS the `studio.sid` every studio service verifies, being the service with no path prefix. It has no file routes. It knows *who you are* and *which engines exist*, never what is on any disk. |

Dev ports: **frontend 5223, backend 8789**, served over TLS at `https://st0.priv.frediver.se`
by the LAN reverse proxy.

## The browser talks to THREE servers

| | `backend` | `@studio/file-service` | `engine/moteur` |
|---|---|---|---|
| runs on | the hosted machine | the **engine's** machine | the engine's machine |
| owns | the engine registry, and `/auth/*` for the whole origin | `<state>/workspace/<user>/<workspace>` — every file op | audio playback |
| reached | same-origin (`/api`, `/auth` via the Vite proxy) | **cross-origin and direct (CORS-gated) when the browser may, else relayed through this origin** | **WebSocket — direct when the browser may, else relayed through this origin** |
| auth | session cookie (`studio.sid`) | `x-studio-{user,workspace,engine-token}` headers | engine token echoed on `whoami` |

**The backend has no file routes and no `store.ts`.** Every file operation lives in
`packages/file-service/src/workspace.ts`. Don't look for `tree`/`read`/`write`/`fmt`
here.

The file service does **not** share the session cookie. Its CORS allowlist
(`packages/file-service/src/cors.ts`) is the actual security boundary: deny-by-default,
loopback/private plus the user-trusted origins in `<state>/web-origins.json`.

`AuthGate` → `EngineGate` → `ProjectGate` → editor, when the address names a project.
When it names none, `main.tsx` mounts `AuthGate` → `Home` instead — the projects page, which
needs the account and neither an engine nor a project (`frontend/docs/projects.md`). One address
short-circuits both: `/external`, the menu of surfaces a second device can drive — every surface
of the project the ENGINE is holding, which `GET /engine/served` answers and which is not the same
question as each workspace's `.studio-active` marker. It is `AuthGate` → `ExternalIndex` and probes
for a machine without claiming one (`frontend/docs/external.md`). It is read BEFORE `parseLaunch`, since a single segment is
otherwise a repository — so `external` is a reserved short name. The engine
picker is unreachable until logged in either way. Auth falls back to a "Dev User" stub when no
`OIDC_*` env is set, but login is still mandatory.

**`/auth/*` is THIS backend's.** Everything is served under one host
(`st0.priv.frediver.se/<service>`), so there is one session cookie — `studio.sid`, signed with the
`SESSION_SECRET` in `env.yaml`'s `common` — and one `redirect_uri` to register with the IdP.
That `redirect_uri` is `<origin>/auth/callback`, with **no prefix**, so it can only be served by
the service that has no prefix: st0, which answers the origin root. pl8, k7 and z0 pass
`mountRoutes: []` and merely verify the cookie.

`/auth/*` follows the root rather than a service name: nothing at the IdP has to change when the
process serving the origin does, since the redirect_uri names the origin and not the app. Spell
auth calls BARE (`/auth/me`), never under `BASE` — for this app the two coincide, for every other
one they do not.

Two consequences to know: logging out anywhere logs you out of every studio service, and
**this backend being down means nobody can log into any studio service** — each will show its
own 401, which does not say so. API calls stay under each service's prefix; auth sits at the
root, and so, separately, does this app.

## Frontend architecture

The long-form rationale lives in `frontend/docs/`, one page per area — read the one that
matches before changing it:

| page | covers |
|---|---|
| `projects.md` | the HOME page — `/` with no project in it: the repositories, the libraries, the shares, the key |
| `playlists.md` | the cog's Playlists screen — `_playlists/` in the repository, over pl8's song catalogue |
| `shell.md` | `App.tsx`/`main.tsx`, the gate stack, the palette |
| `shellRouting.md` | `routes.ts` + `useViewRoute.ts` — view / full / panel against the URL |
| `chainsGraph.md` | the chains renderer and its camera rules |
| `timeline.md` | the keyboard-driven arrangement view |
| `playhead.md` | why the playhead is steered by the engine's frames rather than drawn from them |
| `picture.md` | video lanes on that same timeline, the ruler's two units, the viewport surface |
| `clipEditors.md` | the piano roll and the waveform over one event — and the loop marks they share |
| `masterMeter.md` | the header's meter, what it holds across a pass, and the Fix button's trim |
| `mastering.md` | the `mastering` surface — one quick-master node as three appliances, and why nothing on it normalises |
| `commandBar.md` | the step-by-step palette and module picker |
| `moduleBuilder.md` | the shared builder — and why its parameter list comes from the OPEN project |
| `sharedModules.md` | the file tree's Libraries tab: editing a `@st0` module in place |
| `shared.md` | the OTHER shared: `/@shares/<token>.st0` — this app opened on a frozen snapshot, with no account, no engine and no source |
| `external.md` | `/@external/<surface>` — one surface alone on a second device, and `/external`, the menu it starts from |
| `contextMenu.md` | the right-click menu, derived from the command catalogue |
| `midi.md` | playing a module's params from a MIDI controller |
| `docExamples.md` | how `docs.test.ts` keeps the shipped documentation honest |

### Three data paths (`src/api.ts`)

1. **Backend** (same-origin `/api/*` and `/auth/*`, both at the origin root since st0 answers
   it) — the engine registry and the OIDC flow — through
   `api.ts`'s `engines` (`@studio/engine-browser/access`, which also owns the probe, the
   policy and the lease). Don't spell those routes here again.
2. **File service** (absolute URL) — everything file-shaped (`/tree`, `/file`, `/hints`,
   `/command`, the compiled `/project-doc` and `/graph`). Bare paths, no `/api` prefix. The
   base comes from the PROBE and is set once by `ProjectGate`: direct to the machine when
   the browser is allowed one, otherwise this origin's relay. Never build it yourself.
3. **Engine WebSocket** (`@studio/engine-browser`, wired by `src/hooks/useEngineLink.ts`) —
   live transport and meters. Don't route transport through either server.

### Layout: panes, not tabs

`App.tsx` lays out the panes the project declares: the **frame BESIDE** a column holding the
**timeline over the desk over the strip over the graph**. A picture is wide, so stacking it took a
third of the height off everything below; the column is what stacks. **Every seam between two
panes is draggable** (`components/PaneSplitter.tsx`), and double-clicking one gives the pane back
the fraction it opened at. The EDITOR has no slot in the layout — it is fullscreened deliberately
(`ui editor`) or arrives as a popin when a command sends it to a file
(`frontend/docs/shell.md`). A pane that IS in the layout is **mounted exactly once and never
unmounted**; `hidden` takes it off screen, which is what lets the editor be restyled into a
popin without losing its undo history, and what keeps the viewport's GL context alive while you
are looking elsewhere. One layout, holding whichever of those panes the project declares; `full`
sits on top of it to fullscreen one.

**A note is a MODULE, not a panel.** Neither a module nor a track takes a `docs:` or `todos:`
field, and both schemas are `.strict()`, so a file still holding one refuses to load. A note is a
node of the built-in `@studio/doc`: one input, no output, one field (`content`), drawn as written
on the graph and wired from whatever it is about. Off by default; the note button sits in the
footer beside the mixer. Read `packages/song/docs/docModules.md`, and
`packages/song/scripts/migrateDocFields.ts` is the tool that moves a project's prose out of those
fields and into comments.

**A project declares its SURFACES.** A `surfaces/` folder, one file per special view — `type`,
`layout`, and a `mapping` saying which module each of its components moves. Four types, and the
PAIR is validated:

| type | layout | what it is |
|---|---|---|
| `timeline` | `split` | the arrangement — a pane, and the reason a song draws one at all |
| `viewport` | `split` | the frame: the song's video lanes composited by `@studio/ui-eyes` |
| `turntables` | `split` | the DJ desk, from `@studio/ui-turntables` — what makes a project a SET |
| `mastering` | `split` | the master strip: ONE `quick-master` node drawn as its three parts (`frontend/docs/mastering.md`) |

**Every surface is a PANE**, in the layout and in the pane ring. Which for the viewport is
load-bearing (it owns a GL context and a `<video>` per layer), and for the desk is what puts it
directly over the graph — a fader on the desk is a param on a module there, and a set, declaring
no timeline, is those two panes and nothing else.

> `view` is a word in the `layout` enum and nothing draws in it: a file that says it is
> refused by name rather than by "invalid enum value". A project on disk needs the one-word edit
> to `split`.

**A surface is MOUNTED for as long as the project declares it**; only the drawing is conditional,
which is the ordinary pane invariant (`hidden`, never unmounted). A desk's document — the loaded
songs, the crossfader, the six EQ knobs — is not its screen, and a set does not stop existing
because you went to look at the graph. Being a pane is what spares `SurfaceTab` a split of its
own between the hooks and the screen. Get it wrong and the crossfader re-centres on every round
trip while the sound stays where you put it — see `packages/ui-turntables/docs/deckSet.md`.

A component with no mapping is reported on the surface itself, not by refusing the project.
Read `packages/song/docs/surfaces.md`.

**There is ONE layout, and nobody chooses it either.** Which panes it holds is what the open
project DECLARES: `viewPanes` in `src/routes.ts` takes the surface flags and answers with the
pane ring and the fullscreen list, and that one list closes the header buttons, the number keys,
`ui <pane>` and the mobile tabs together. A project with no `surfaces/timeline.yaml` draws no
timeline, and the transport and the minimap go with it.

`project.yaml` has no `project_type` and there is no `View` type: `surfaces/` answers the same
question and is the only thing that answers it, so two sources cannot contradict. Read
`packages/song/docs/surfaces.md` before touching any of it.

The vocabulary is two words, and `src/routes.ts` is where they are declared —
read it before changing layout. A **pane** is one of six (`editor | viewport | timeline |
turntables | mastering | chains`) and is what `full` fullscreens; four of them — `timeline`,
`viewport`, `turntables` and `mastering` — are mounted only when the project declares the
matching surface. A **panel** is one of two (`graph | logs`) and is what
the editor column shows. Two things are deliberately NOT panels: the MIXER, a view of the graph
drawn in the graph's pane, and a clip's CONTENTS, which the graph's own slot draws. Both are URL state (`src/useViewRoute.ts`); see
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

- **Editor** — `@uiw/react-codemirror` with `@studio/ui-editor` for YAML support and a
  hint-driven completion source. Vim mode is on by default (a global preference in
  `<state>/preferences.yaml`). **There is no Save button here**: the buffer is written as soon
  as it is a document the compiler could read, and held back with the reason while it is not
  (`@studio/ui-editor/autosave`, whose `docs/autosave.md` is the page to read first). The MODULE
  BUILDER is the one screen that does have one — see Modules below. `:w` and
  Ctrl+S mean "now", not "at all" — they flush the timer and cannot overrule the rule.
- **Modules** — `@studio/ui-module-builder`, the same component pl8 runs, as a full-screen
  overlay over the shell. It is reached by the **Builder** button on a module file's editor
  toolbar, not by opening the file: `module.yaml` must still open its text, because that is the
  path a shared module forks through. `src/api.ts`'s `moduleStore` is the seam — see that
  package's `docs/store.md`, in particular why a save can come back saying it landed somewhere
  else.

  **The builder is one of the two screens here with a Save button**, and the exception is
  deliberate: a module is four files describing one thing, and on a shared one a save is a
  *publish* — a commit and a push onto a repository other people read. Ctrl+S and `:w` mean that
  button, and they save all four files, not the pane you are looking at. `useAutosave`'s `manual`
  mode is what turns the timer off while keeping its validation and its held-back buffers.

  The other is the **Commands settings page**, and for a different reason: what it edits is one
  account-wide document held at the root of the app, so a write-through was a round trip *and* a
  re-render of the whole shell per keystroke (`frontend/docs/shell.md`).

  The file tree has a **second tab, Libraries**, listing every level a module can live at —
  `@project`, `@workspace`, `@st0`, `@engine` — nearest first, which is precedence. They come
  from `GET /module-libraries`, NOT from `/tree`: that one is rooted at the active project and
  excludes the shared folders on purpose. `@engine` is read-only and has no folder at all (it is
  the plugin scan, synthesised); the others offer **New folder…** and **New module…**. The
  Project tab drops the song's own `modules/`, which is `@project` here. Only an `@st0` module
  opens the same builder **read-only**, with an Edit button
  behind a confirmation; Save then writes into `_libraries/…`, commits and pushes that
  repository, and records the new version in the song with one path-limited commit moving the
  gitlink — nothing forks, because that library is the only copy. One store and one path
  space: the libraries are a git submodule inside the workspace
  (`packages/song/docs/sharedFolders.md`), so the file service already serves them.
  `frontend/docs/sharedModules.md` is the page to read; `@banc` opens a library CHAIN and
  nothing else.

  **st0 will not open a project without a libraries repository.** The account declares one on
  this app's own home page — the card above everything else — and `ProjectGate` refuses before it
  clones anything. See `frontend/docs/projects.md` and
  `packages/project-shell/docs/launch.md`.
- **Chains** — dagre (`@studio/ui-chains`) for layout, `@studio/ui-chains-react`'s
  `DomChains.tsx` for drawing: HTML nodes over a canvas of signal cables, with an SVG layer
  between them for the labels, the automation arrows and the hit paths. **Never hand-roll
  layout or edge routing.** dagre owns both; the renderer consumes its numbers. Pan/zoom is one
  CSS transform on the `.dgx-world` wrapper — and the cable canvas is deliberately OUTSIDE that
  wrapper, taking the same camera on its 2D context, because a canvas scaled by CSS goes blurry. Both halves live outside this app because the
  médiathèque and the decks draw the same view — see that package's `docs/hosting.md` for
  what a host owes it. st0 is the demanding host: the command bar, context menu and edge
  inserts are optional props the other two pass nothing for.
- **Timeline** — vim-style: `hjkl` movement, `v` for visual selection, `z`/`Shift+z`
  for the zoom stack, `m`/`s` for mute/solo. Neither is a session flag: `m` rewrites the
  lane's BYPASS in `graph.yaml` — a lane is a module, and its mute is that module's bypass —
  and `s` toggles the lane in project.yaml's root `soloed:` list, several at once, resolved by
  the ENGINE (`packages/song/docs/trackModules.md`). Selection
  and zoom are a stack; the innermost entry describes the view. Unlike chains, this one
  stays st0-only.

## The backend in detail

**Two source files**: `server.ts` and `types/express.d.ts`. That is the whole thing — the
registry itself is `@studio/engine-registry`, shared with pl8 and the decks because each
service holds its own copy of it (that package's `docs/shared.md` says why). Don't look for
a `registry.ts` here.

- Browser-facing registry routes (`/api/engines`, `/api/engine/*`) require a session.
- Engine-facing routes (`/api/registry/{heartbeat,deregister}`) stay open — that is the
  supervisor, authenticated by its own token.
- The Vite dev server proxies BOTH `/api` and `/auth` to this backend (`proxyPaths`), which is
  what makes the dev server usable when visited directly on its port. Every other SPA on the
  origin has to point its own `/auth` proxy back here — `AUTH_BACKEND_PORT` in
  `scripts/dev-hosts.mjs` is where that port is named once.
- Auth and engine assignment are separate concerns: the assignment ("in use" badge) is
  a per-engine lease **across users**, not per-workspace across tabs.

Two traps in `server.ts` that read as ordinary lines:

**`OIDC_SCOPES` must keep `groups`.** z0 reads this same cookie and gates its editor, presenter,
monitor and remote on group membership (`AUTH_ADMIN_GROUPS`). `@frediverse/oidc` defaults to
`openid profile email`, which puts an **empty** groups array in every session and 403s every admin
surface with nothing to explain it. The value comes from `env.yaml`'s `common`, which already reads
`openid profile email groups`. Note also that the code passes `scopes` only when non-empty: the
package falls back on nullish only, so an empty array asks the IdP for *no* scopes rather than for
its defaults.

**The prefs zod schema is the GATE, not a description.** A zod object strips what it does not
declare, so a field the frontend saves and `prefsSchema` does not name would be accepted, answered
`{ok:true}`, and dropped. `preferencesRouter` refuses such a write out loud (`droppedKeys`), but
the rule to remember is that widening `St0Prefs` in the browser is only half of adding a
preference.
`engineId` and not an address, for the same kind of reason: an engine's IP moves between networks
while its identity does not, and storing a URL would pin someone to the network they first logged
in from.

## st0 is opened ON a workspace, and plays ONE of the projects in it

A workspace is one git repository and holds **several projects**. The editor's tree is the whole
workspace, and the ▶ on a project row is what hands that one to the engine — `POST /open`, which
writes `.studio-active` and switches the session, with no navigation and no remount
(`packages/file-service/docs/activeProject.md`). The address may still name a project, and that
is what it opens ON; a bare `/<dépôt>` opens the one last played.

**A workspace does not need a repository, and starts EMPTY.** `Nouveau` on the home page git-inits
one here with no remote and no project; opening it draws the first-project wizard, since the
archetype decides what the screen shows and that is a question better asked where the answer will
be looked at. Everything works in it but pushing; `Publier` is the day it gets an `origin`, and
`Importer` is the clone of one that already exists (`packages/file-service/docs/workspaces.md`).

## the HOME page is where a workspace is chosen

**This app does not own workspaces**, and never will: pl8 stores the repositories
(`apps/pl8/docs/projects.md`) and the engine's machine holds every working copy. What this app
owns is the SCREEN above a project, at `/` with nothing after it — the repositories, the
projects inside them, the libraries repository and the published shares. The deploy key is NOT
here any more — it is the Sync tab of `/@settings` (`apps/st0-desktop/docs/settings.md`),
which the hosted origin draws too, since the key is the account's rather than the app's. The
routes stay pl8's while the screen is here, and `frontend/docs/projects.md` is the page that says
why.

A project is named by an ADDRESS — the repository by its short name, then the project folder:

```
/songs/first.st0
/band/albums/winter.st0/timeline      …with the app's own route following it
```

`ProjectGate` asks pl8 for the git URI behind that name
(`GET /api/projects/by-name/:name`), resolves it to a folder on the chosen engine's machine —
`GET /workspaces/by-repo`, cloning it with a visible progress bar if that machine has never
seen it — then opens the project. Arriving with no project in the address is the home page rather
than an error to redirect away from, and `main.tsx` branches on `parseLaunch` before mounting
anything. There is deliberately no SECOND picker — z0's editor comes back to this one.

**The project is the router's `basename`** (`projectBasename` in `main.tsx`), which is why
there is no storage anywhere near it: React Router only writes below its basename, so
`routes.ts` cannot rewrite the project away, and a reload or a pasted link simply re-reads the
address. Hold it in a query string and a session instead, and a tab handed a project that does
not exist can never get out of it. Read
`packages/project-shell/docs/launch.md` before touching any of this.

The gate itself is that package's too, and z0's editor mounts the same one; `components/ProjectGate.tsx`
is a wrapper holding this app's wording and what to render once the project is open.

**There is no workspace picker anywhere in this app**, and a folder under
`<state>/workspace/<you>/` is the wrong level to offer a choice at. The home page lists
REPOSITORIES, which belong to a person rather than to a machine, and a workspace is what the gate
resolves one INTO. The deploy key is pl8's — one key per person, which the file service fetches a
copy of (`packages/git-repos/docs/keys.md`); this app draws the card that shows it.

Identity is the OIDC email, which names the engine SESSION rather than a folder — the workspaces are `<state>/workspace/<workspace>` with nobody underneath (`packages/engine-client/docs/paths.md`) — and the active
project is remembered per-workspace in a `.studio-active` marker. There is **no global session
file**; the workspace is the scope.

## Many browsers at once (no lease)

Any number of tabs may drive the same workspace concurrently. Last write wins; each
tab's polls (`workspace`/`project`/`tree` on 2s/700ms intervals) reconcile the view.

Anything gated on "has a file changed" reads the `/revision` token through
`hooks/useRevision.ts`, which polls it **once per tab** however many consumers there are —
never on a timer of its own. Two hooks each running their own 2s timer over one route is the same
request twice a second, and every request is real work for whatever sits between the browser and
the service.

## Key conventions

- **The engine never parses song files.** It only receives compiled JSON. Swap this
  frontend for another and the engine is unchanged — which is exactly what the médiathèque's
  module previews and the decks do today, on the same binary, over the same protocol.
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
  (`flex`, `w-16`) are generated anyway. Leave out `packages/ui-turntables/src` and the desk's
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
