# AGENTS.md — l8

A **text-based DAW**. Your song is a folder of YAML files; the terminal or a web editor
is your studio.

**This directory is the web editor, and only that.** The engine (`engine/moteur`), the
tray (`engine/capot`) and the brain packages (`packages/*`, all `@studio/*`) moved out
when they stopped belonging to l8 alone — the repo-root `AGENTS.md` holds the map of
the whole audio side. Two workspaces live here:

| Package | Role |
|---|---|
| `frontend` (`l8-frontend`) | React + Vite + Tailwind v4 + `@frediverse/ui`. The visual editor: YAML code editor (CodeMirror), timeline, chains graph. |
| `backend` (`l8-backend`) | Express — **the engine registry only**, plus verifying the session st0 mints. It has no file routes and no auth routes. It knows *who you are* and *which engines exist*, never what is on any disk. |

Dev ports: **frontend 5223, backend 8789**, served over TLS at `https://st0.priv.frediver.se/l8`
by the LAN reverse proxy.

## The browser talks to THREE servers

| | `backend` | `@studio/file-service` | `engine/moteur` |
|---|---|---|---|
| runs on | the hosted machine | the **engine's** machine | the engine's machine |
| owns | the engine registry (auth is st0's) | `~/.studio/root/<user>/<workspace>` — every file op | audio playback |
| reached | same-origin (`/api`, `/auth` via the Vite proxy) | **cross-origin and direct (CORS-gated) when the browser may, else relayed through this origin** | **WebSocket — direct when the browser may, else relayed through this origin** |
| auth | session cookie (`studio.sid`) | `x-studio-{user,workspace,engine-token}` headers | engine token echoed on `whoami` |

**The backend has no file routes and no `store.ts`.** Every file operation lives in
`packages/file-service/src/workspace.ts`. Don't look for `tree`/`read`/`write`/`fmt`
here.

The file service does **not** share the session cookie. Its CORS allowlist
(`packages/file-service/src/cors.ts`) is the actual security boundary: deny-by-default,
loopback/private plus the user-trusted origins in `~/.studio/web-origins.json`.

`AuthGate` → `EngineGate` → `ProjectGate` → editor. The engine picker is unreachable
until logged in. Auth falls back to a "Dev User" stub when no `OIDC_*` env is set, but
login is still mandatory.

**`/auth/*` belongs to st0, not to this backend.** Everything is served under one host
(`st0.priv.frediver.se/<service>`), so there is one session cookie — `studio.sid`, signed with the
`SESSION_SECRET` in `env.yaml`'s `common` — and one `redirect_uri` to register with the IdP.
That `redirect_uri` is `<origin>/auth/callback`, with **no prefix**, so it can only be served
by the service that has no prefix: st0, which answers the origin root. This backend owned it
while the bare origin merely redirected here, and now passes `mountRoutes: []` exactly as z0
and k7 always have — it verifies the cookie and mounts no auth routes.

Two consequences to know: logging out anywhere logs you out of every studio service, and
**st0 being down means nobody can log into l8 either** — you will see l8's own 401, which
does not say so. API calls stay under each service's prefix; only auth sits at the root.

## Frontend architecture

The long-form rationale lives in `frontend/docs/`, one page per area — read the one that
matches before changing it:

| page | covers |
|---|---|
| `shell.md` | `App.tsx`/`main.tsx`, the gate stack, the palette |
| `shellRouting.md` | `routes.ts` + `useViewRoute.ts` — view / full / panel against the URL |
| `chainsGraph.md` | the chains renderer and its camera rules |
| `timeline.md` | the keyboard-driven arrangement view |
| `picture.md` | video lanes on that same timeline, the ruler's two units, the viewport surface |
| `commandBar.md` | the step-by-step palette and module picker |
| `moduleBuilder.md` | the shared builder — and why its parameter list comes from the OPEN project |
| `sharedModules.md` | the file tree's Libraries tab: editing a `@st0` module in place |
| `contextMenu.md` | the right-click menu, derived from the command catalogue |
| `midi.md` | playing a module's params from a MIDI controller |
| `docExamples.md` | how `docs.test.ts` keeps the shipped documentation honest |

### Three data paths (`src/api.ts`)

1. **Backend** (same-origin `/api/*`) — auth + engine registry only, through
   `api.ts`'s `engines` (`@studio/engine-browser/access`, which also owns the probe, the
   policy and the lease). Don't spell those routes here again.
2. **File service** (absolute URL) — everything file-shaped (`/tree`, `/file`, `/hints`,
   `/command`, the compiled `/project-doc` and `/graph`). Bare paths, no `/api` prefix. The
   base comes from the PROBE and is set once by `ProjectGate`: direct to the machine when
   the browser is allowed one, otherwise this origin's relay. Never build it yourself.
3. **Engine WebSocket** (`@studio/engine-browser`, wired by `src/hooks/useEngineLink.ts`) —
   live transport and meters. Don't route transport through either server.

### Layout: panes, not tabs

`App.tsx` stacks the panes the project declares, full width: the **frame over the timeline over
the graph**. The EDITOR has no slot in either layout — it is fullscreened deliberately
(`ui editor`) or arrives as a popin when a command sends it to a file
(`frontend/docs/shell.md`). A pane that IS in the layout is **mounted exactly once and never
unmounted**; `hidden` takes it off screen, which is what lets the editor be restyled into a
popin without losing its undo history, and what keeps the viewport's GL context alive while you
are looking elsewhere. Two views: `global` and `live` (the graph alone). `full` sits on top of a
view to fullscreen one pane.

**A note is a MODULE, not a panel.** The Docs panel is gone, and with it the `docs:`/`todos:`
fields modules and tracks carried — both schemas are `.strict()`, so a file still holding one
refuses to load. A note is a node of the built-in `@studio/doc`: one input, no output, one
field (`content`), drawn as written on the graph and wired from whatever it is about. Off by
default; the note button sits in the footer beside the mixer. Read
`packages/song/docs/docModules.md`, and `packages/song/scripts/migrateDocFields.ts` is the tool
that moves an old project's prose into comments.

**A project declares its SURFACES.** A `surfaces/` folder, one file per special view — `type`,
`layout`, and a `mapping` saying which module each of its components moves. Three types and two
layouts, and the PAIR is validated:

| type | layout | what it is |
|---|---|---|
| `timeline` | `split` | the arrangement — a pane, and the reason a song draws one at all |
| `viewport` | `split` | the frame: the song's video lanes composited by `@studio/ui-eyes` |
| `turntables` | `view` | the DJ desk, from `@studio/ui-turntables` — what makes a project a SET |

A `view` surface gets a button at the top right and takes the screen like the help page: a
`RouteState.surface`, **not** a `Pane`, because the list is the project's and a union could not
name it. A `split` one is *in* the layout, in the pane ring — which for the viewport is
load-bearing, since it owns a GL context and a `<video>` per layer.

**Both are MOUNTED for as long as the project declares them**; only the drawing is conditional.
A desk's document — the loaded songs, the crossfader, the six EQ knobs — is not its screen, and
a set does not stop existing because you went to look at the graph. `SurfaceTab` owns that
split: hooks above a line, screen below it. Get it wrong and the crossfader re-centres on every
round trip while the sound stays where you put it — see
`packages/ui-turntables/docs/deckSet.md`.

A component with no mapping is reported on the surface itself, not by refusing the project.
Read `packages/song/docs/surfaces.md`.

**`view` is the one piece of screen state nobody chooses.** It is what the open PROJECT is —
`project.yaml`'s `project_type`, `arrangement` or `live` — and a live project has no timeline at
all, so the transport, the minimap and the pane buttons go with it. `viewPanes` in `src/routes.ts`
says what each layout does with the panes, and its empty `fullscreen` list for `live` is what
closes the header buttons, the number keys, `ui <pane>` and the mobile tabs in one place. Read
`packages/song/docs/projectMode.md` before touching any of it.

The vocabulary is three words, not two, and `src/routes.ts` is where they are declared —
read it before changing layout. A **pane** is one of four (`editor | viewport | timeline |
chains`) and is what `full` fullscreens; two of them, `timeline` and `viewport`, are mounted
only when the project declares the matching surface. A **panel** is one of three (`graph | docs | logs`) and is what
the editor column shows. Two things are deliberately NOT panels: the MIXER, a view of the graph
drawn in the graph's pane, and a clip's CONTENTS, which the graph's own slot draws. A **view** is the arrangement of panes. All three are URL state (`src/hooks/useViewRoute.ts`); see
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
  `~/.studio/preferences.yaml`). **There is no Save button here**: the buffer is written as soon
  as it is a document the compiler could read, and held back with the reason while it is not
  (`@studio/ui-editor/autosave`, whose `docs/autosave.md` is the page to read first). The MODULE
  BUILDER is the one screen that does have one — see Modules below. `:w` and
  Ctrl+S mean "now", not "at all" — they flush the timer and cannot overrule the rule.
- **Modules** — `@studio/ui-module-builder`, the same component st0 runs, as a full-screen
  overlay over the shell. It is reached by the **Builder** button on a module file's editor
  toolbar, not by opening the file: `module.yaml` must still open its text, because that is the
  path a shared module forks through. `src/api.ts`'s `moduleStore` is the seam — see that
  package's `docs/store.md`, in particular why a save can come back saying it landed somewhere
  else.

  **The builder is the one screen here with a Save button**, and the exception is deliberate: a
  module is four files describing one thing, and on a shared one a save is a *publish* — a
  commit and a push onto a repository other people read. Ctrl+S and `:w` mean that button, and
  they save all four files, not the pane you are looking at. `useAutosave`'s `manual` mode is
  what turns the timer off while keeping its validation and its held-back buffers.

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
  (`packages/song/docs/sharedFolders.md`), so the file service already serves them. This
  replaced the module **bench**; `frontend/docs/sharedModules.md` is the page to read, and
  `@banc` now opens only a library CHAIN.

  **l8 will not open a project without a libraries repository.** The account declares one in
  st0's Projets section, and `ProjectGate` refuses before it clones anything — see
  `packages/project-shell/docs/launch.md`.
- **Chains** — dagre (`@studio/ui-chains`) for layout, `@studio/ui-chains-react`'s
  `DomChains.tsx` for drawing: HTML nodes over a canvas of signal cables, with an SVG layer
  between them for the labels, the automation arrows and the hit paths. **Never hand-roll
  layout or edge routing.** dagre owns both; the renderer consumes its numbers. Pan/zoom is one
  CSS transform on the `.dgx-world` wrapper — and the cable canvas is deliberately OUTSIDE that
  wrapper, taking the same camera on its 2D context, because a canvas scaled by CSS goes blurry. Both halves live outside this app because the
  médiathèque and the decks draw the same view — see that package's `docs/hosting.md` for
  what a host owes it. l8 is the demanding host: the command bar, context menu and edge
  inserts are optional props the other two pass nothing for.
- **Timeline** — vim-style: `hjkl` movement, `v` for visual selection, `z`/`Shift+z`
  for the zoom stack, `m`/`s` for mute/solo. Neither is a session flag: `m` rewrites the
  lane's BYPASS in `chains.yaml`, and `s` bypasses every other lane — a lane is a module,
  and its mute is that module's bypass (`packages/song/docs/trackModules.md`). Selection
  and zoom are a stack; the innermost entry describes the view. Unlike chains, this one
  stays l8-only.

## The backend in detail

**Two source files**: `server.ts` and `types/express.d.ts`. That is the whole thing — the
registry itself is `@studio/engine-registry`, shared with st0 and the decks because each
service holds its own copy of it (that package's `docs/shared.md` says why). Don't look for
a `registry.ts` here.

- Browser-facing registry routes (`/api/engines`, `/api/engine/*`) require a session.
- Engine-facing routes (`/api/registry/{heartbeat,deregister}`) stay open — that is the
  supervisor, authenticated by its own token.
- The Vite dev server proxies `/api` to the backend, and **not** `/auth` — the proxy sends
  that to st0 origin-wide, so a proxy here would forward to routes that no longer exist.
- Auth and engine assignment are separate concerns: the assignment ("in use" badge) is
  a per-engine lease **across users**, not per-workspace across tabs.

## l8 is opened ON a project — it does not pick one

**This app no longer owns workspaces.** st0 owns the repositories (`apps/st0/docs/projects.md`)
and links here with an ADDRESS — the repository by its short name, then the project folder:

```
/l8/songs/first.l8
/l8/band/albums/winter.l8/timeline      …with the app's own route following it
```

`ProjectGate` asks st0 for the git URI behind that name
(`GET /api/projects/by-name/:name`), resolves it to a folder on the chosen engine's machine —
`GET /workspaces/by-repo`, cloning it with a visible progress bar if that machine has never
seen it — then opens the project. Arriving with no project in the address redirects to st0's
`/projects`; there is deliberately no fallback picker.

**The project is the router's `basename`** (`projectBasename` in `main.tsx`), which is why
there is no storage anywhere near it: React Router only writes below its basename, so
`routes.ts` cannot rewrite the project away, and a reload or a pasted link simply re-reads the
address. It used to be `?repo=&project=` held in `sessionStorage`, and a tab handed a project
that did not exist could never get out of it. Read
`packages/project-shell/docs/launch.md` before touching any of this.

The gate itself is that package's too, and z0's editor mounts the same one; `components/ProjectGate.tsx`
is a wrapper holding this app's wording and what to render once the project is open.

Gone from here: `WorkspaceGate`, `WorkspaceSelect`, `SshKeyPage`, and `api.listWorkspaces` /
`createWorkspace` / `sshKey` / `generateSshKey`. The deploy key is st0's now — one key per
person, which the file service fetches a copy of (`packages/git-repos/docs/keys.md`).

Identity is still the OIDC email → folder slug → `~/.studio/root/<slug>/<workspace>`, and the
active project is still remembered per-workspace in a `.studio-active` marker. What changed is
who chooses. There is **no global session file**; the workspace is the scope.

## Many browsers at once (no lease)

Any number of tabs may drive the same workspace concurrently. Last write wins; each
tab's polls (`workspace`/`project`/`tree` on 2s/700ms intervals) reconcile the view.

Anything gated on "has a file changed" reads the `/revision` token through
`hooks/useRevision.ts`, which polls it **once per tab** however many consumers there are —
never on a timer of its own. Two hooks each running their own 2s timer over the same route was
the same request twice a second, and every request is real work for whatever sits between the
browser and the service.

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
  unstyled.
- `src/docs/pages.ts`'s `import.meta.glob` — an empty glob leaves `/docs` blank *and*
  makes `docs.test.ts` pass vacuously, because its `it()`s iterate an empty list. Check
  the test **count**, not the exit code.
