# AGENTS.md — lanes

A **text-based DAW**. Your song is a folder of YAML files; the terminal or a web editor
is your studio.

**This directory is the web editor, and only that.** The engine (`apps/moteur`), the
tray (`apps/capot`) and the brain packages (`packages/*`, all `@studio/*`) moved out
when they stopped belonging to lanes alone — the repo-root `AGENTS.md` holds the map of
the whole audio side. Two workspaces live here:

| Package | Role |
|---|---|
| `frontend` (`lanes-frontend`) | React + Vite + Tailwind v4 + `@frediverse/ui`. The visual editor: YAML code editor (CodeMirror), timeline, chains graph, video compositor. |
| `backend` (`lanes-backend`) | Express — **OIDC auth + engine registry only**. It has no file routes. It knows *who you are* and *which engines exist*, never what is on any disk. |

Dev ports: **frontend 5223, backend 8789**, served over TLS at `https://lanes.test`
by the repo-root Caddyfile.

## The browser talks to THREE servers

| | `backend` | `@studio/file-service` | `apps/moteur` |
|---|---|---|---|
| runs on | the hosted machine | the **engine's** machine | the engine's machine |
| owns | OIDC auth + engine registry | `~/.lanes/root/<user>/<workspace>` — every file op | audio playback |
| reached | same-origin (`/api`, `/auth` via the Vite proxy) | **cross-origin, direct** (CORS-gated) | **WebSocket, direct** |
| auth | session cookie (`lanes.sid`) | `x-lanes-{user,workspace,engine-token}` headers | engine token echoed on `whoami` |

**The backend has no file routes and no `store.ts`.** Every file operation lives in
`packages/file-service/src/workspace.ts`. Don't look for `tree`/`read`/`write`/`fmt`
here.

The file service does **not** share the session cookie. Its CORS allowlist
(`packages/file-service/src/cors.ts`) is the actual security boundary: deny-by-default,
loopback/private plus the user-trusted origins in `~/.lanes/web-origins.json`.

`AuthGate` → `EngineGate` → `WorkspaceGate` → editor. The engine picker is unreachable
until logged in. Auth falls back to a "Dev User" stub when no `OIDC_*` env is set, but
login is still mandatory.

## Frontend architecture

### Three data paths (`src/api.ts`)

1. **Backend** (same-origin `/api/*`) — auth + engine registry only.
2. **File service** (cross-origin, absolute URL) — everything file-shaped (`/tree`,
   `/file`, `/hints`, `/command`, the compiled `/project-doc` and `/graph`). Bare
   paths, no `/api` prefix.
3. **Engine WebSocket** (`src/engine.ts`) — live transport and meters. Don't route
   transport through either server.

### Layout: panes, not tabs

`App.tsx` shows three panes at once — editor (left), timeline (top-right), chains
(bottom-right). Each pane is **mounted exactly once, in every layout**. `hidden` takes
a pane off screen; nothing unmounts. Two views: `global` (chains graph) and `video`
(video compositor). `full` sits on top of a view to fullscreen one pane.

### Commands are the CLI's, verbatim

The command bar calls `/complete` and `/command` on the **file service**, which
dispatch through `@studio/commands` — the same SIDs `lanes cmd` runs. Add a feature
there, not here. Web-local commands are only the shell's own view state (tabs, close,
edit sequence/clip in `LOCAL_COMMANDS`).

### Every shortcut names a command (`src/keys.ts`)

Keys are looked up in `KEYS` and the named command runs through `runCommand`. `;`
focuses the command bar (`@command`). Bindings can be conditional, ordered, and
interpolate conditions into command names (`f` → `{focus_pane}`).

### Editor, chains, timeline, video

- **Editor** — `@uiw/react-codemirror` with `@studio/ui-editor` for YAML support and a
  hint-driven completion source. Vim mode is on by default (a global preference in
  `~/.lanes/preferences.yaml`); `:w` is wired to the tab's `onSave`.
- **Chains** — dagre (`@studio/ui-chains`) for layout, `DomChains.tsx` for drawing:
  HTML nodes plus one SVG cable layer. **Never hand-roll layout or edge routing.**
  dagre owns both; the renderer consumes its numbers. Pan/zoom is one CSS transform on
  the `.dgx-world` wrapper. This view is destined to be shared with mediatek and
  platines, which is why the geometry already lives outside the app.
- **Timeline** — vim-style: `hjkl` movement, `v` for visual selection, `z`/`Shift+z`
  for the zoom stack, `m`/`s` for mute/solo (which rewrite `tracks/*.yaml`, not a
  session flag). Selection and zoom are a stack; the innermost entry describes the
  view. Unlike chains, this one stays lanes-only.
- **Video** — `@studio/ui-eyes`, a WebGL compositor. One `<video>` per layer, not per
  clip. The `video` view is the default for songs with video tracks (`autoVideoRef`).

## The backend in detail

Four source files: `server.ts`, `registry.ts`, `routes/registry.ts`, plus types.

- Browser-facing registry routes (`/api/engines`, `/api/engine/*`) require a session.
- Engine-facing routes (`/api/registry/{heartbeat,deregister}`) stay open — that is the
  supervisor, authenticated by its own token.
- The Vite dev server proxies `/api` and `/auth` to the backend.
- Auth and engine assignment are separate concerns: the assignment ("in use" badge) is
  a per-engine lease **across users**, not per-workspace across tabs.

## Users and workspaces

Identity is the OIDC email → folder slug → `~/.lanes/root/<slug>/<workspace>`.
Workspace CRUD via `GET/POST /workspaces`; the active project is remembered
per-workspace in a `.lanes-active` marker.

Workspaces can be **cloned from SSH git repos** (`POST /workspaces/clone`) with a
per-user deploy key under `~/.lanes/ssh/<slug>/`. The clone blanks the global git config
(`GIT_CONFIG_GLOBAL=/dev/null`) so an `url.insteadOf` rewrite can't sidestep the key.

There is **no global session file**. `~/.lanes/session.json` is gone; the workspace is
the scope.

## Many browsers at once (no lease)

Any number of tabs may drive the same workspace concurrently. Last write wins; each
tab's polls (`workspace`/`project`/`tree` on 2s/700ms intervals) reconcile the view.

## Key conventions

- **The engine never parses song files.** It only receives compiled JSON. Swap this
  frontend for another and the engine is unchanged — which is exactly what mediatek and
  platines will do.
- **Commands are the single source of truth.** `@studio/commands` owns the SID →
  handler mapping, and both the CLI and the web dispatch through it.
- **Wire shapes live in `@studio/engine-protocol`.** A wire change must also update the
  C++ serialization — verified by running the engine, not by TypeScript.
- **All JS packages are consumed as source.** No build step, run via `tsx`, imported
  through `package.json` `exports` subpaths — bare deep imports fail on purpose.

## Verify

`npm run build` is `vite build && tsc --noEmit` for the frontend; the backend has only
`tsc --noEmit`, run directly. **There are no tests for the frontend shell** — for UI
work, run the app and exercise it in the browser.

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
