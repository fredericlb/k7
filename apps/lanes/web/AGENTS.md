# AGENTS.md — web editor

The **web-based DAW editor**. Three workspace packages:

| Package | Role |
|---|---|
| `web/frontend` | React + Vite + Tailwind v4 + `@frediverse/ui`. The visual editor: YAML code editor (CodeMirror), timeline (piano roll + arrangement), chains graph (dagre layout + DOM rendering), video compositor. |
| `web/backend` | Express — **OIDC auth + engine registry only**. Has no file routes. Knows *who you are* and *which engines exist* — never what is on any disk. |
| `web/shared` | `@lanes/web-shared` — wire types shared between frontend and backend (engine addresses, assignment lease types). |

Dev ports: **frontend 5223, backend 8789**. Served over TLS at `https://studio.test`
by the repo-root Caddyfile.

## The browser talks to THREE servers

| | web/backend | file-service (`packages/file-service`) | engine (C++) |
|---|---|---|---|
| runs on | the hosted machine | the **engine's** machine | the engine's machine |
| owns | OIDC auth + engine registry | `~/.lanes/root/<user>/<workspace>` — every file op | audio playback |
| reached | same-origin (`/api`, `/auth` via Vite proxy) | **cross-origin, direct** (CORS-gated) | **WebSocket, direct** |
| auth | session cookie (`lanes.sid`) | `x-lanes-{user,workspace,engine-token}` headers | engine token echoed on `whoami` |

**The backend has no file routes and no `store.ts`.** All file operations live in
`packages/file-service/src/workspace.ts`. Don't look for `tree`/`read`/`write`/`fmt`
here.

## Auth

The backend uses `@frediverse/oidc`'s `setupAuth` — mounts `/auth/{login,callback,logout,me}`.
Falls back to a "Dev User" stub when no `OIDC_*` env is set, but login is still mandatory.
Session lives in a signed cookie (`lanes.sid`).

`AuthGate` → `EngineGate` → `WorkspaceGate` → editor. The engine picker is unreachable
until logged in.

The file service does **not** share the session cookie. Its auth is the `x-lanes-*`
headers; its CORS allowlist (`file-service/src/cors.ts`) is the actual security
boundary (deny-by-default, loopback/private + user-trusted origins from
`~/.lanes/web-origins.json`).

## Frontend architecture

### Three data paths (`src/api.ts`)

1. **Backend** (same-origin `/api/*`) — auth + engine registry only.
2. **File service** (cross-origin, absolute URL) — all file-shaped operations (`/tree`,
   `/file`, `/hints`, `/command`, compiled `/project-doc` + `/graph`). Bare paths, no
   `/api` prefix.
3. **Engine WebSocket** (`src/engine.ts`) — live transport/meters. Don't route transport
   through either server.

### Layout: panes, not tabs

`App.tsx` shows three panes at once — editor (left), timeline (top-right), chains
(bottom-right). Each pane is **mounted exactly once, in every layout**. `hidden` takes
a pane off screen; nothing unmounts. Two views: `global` (chains graph) and `video`
(video compositor). `full` sits on top of a view to fullscreen one pane.

### Commands are the CLI's, verbatim

The command bar calls `/complete` and `/command` on the **file service**, which dispatch
through `@lanes/commands` — the same SIDs `lanes cmd` runs. Add a feature there,
not here. Web-local commands are only the shell's own view state (tabs, close, edit
sequence/clip in `LOCAL_COMMANDS`).

### Every shortcut names a command (`src/keys.ts`)

Keys are looked up in `KEYS` and the named command runs through `runCommand`. `;`
focuses the command bar (`@command`). Bindings can be conditional, ordered, and
interpolate conditions into command names (`f` → `{focus_pane}`).

### Editor

`@uiw/react-codemirror` with YAML language support (`@lanes/ui-editor`)
and a hint-driven completion source. Vim mode is on by default (global preference in
`~/.lanes/preferences.yaml`). `:w` is wired to the tab's `onSave`.

### Chains graph

dagre (`@dagrejs/dagre`) for layout + DOM renderer (`DomChains.tsx`) for drawing — HTML
nodes + one SVG cable layer. **Never hand-roll layout or edge routing.** dagre owns
both; the renderer consumes its numbers. Pan/zoom is one CSS transform on the
`.dgx-world` wrapper.

### Timeline

Vim-style: `hjkl` movement, `v` for visual selection, `z`/`Shift+z` for zoom stack,
`m`/`s` for mute/solo (rewrites `tracks/*.yaml`, not a session flag). Selection + zoom
are a stack; the innermost entry describes the view.

### Video

`@lanes/ui-eyes` — WebGL compositor. One `<video>` per layer (not per clip). The
`video` view defaults for songs with video tracks (`autoVideoRef`).

## The backend in detail

Four source files: `server.ts`, `registry.ts`, `routes/registry.ts`, plus types.

- Browser-facing registry routes (`/api/engines`, `/api/engine/*`) require a session.
- Engine-facing routes (`/api/registry/{heartbeat,deregister}`) stay open — that's the
  engine-host supervisor, authenticated by its own token.
- The Vite dev server proxies `/api` and `/auth` to the backend.
- Auth and engine assignment are separate concerns: the engine assignment ("in use"
  badge) is a per-engine lease across users, not per-workspace across tabs.

## Users and workspaces

Identity is the OIDC email → folder slug → `~/.lanes/root/<slug>/<workspace>`.
Workspace CRUD via `GET/POST /workspaces`. Active project per-workspace via
`.lanes-active` marker.

Workspaces can be **cloned from SSH git repos** (`POST /workspaces/clone`) with a
per-user deploy key under `~/.lanes/ssh/<slug>/`. The clone blanks global git config
(`GIT_CONFIG_GLOBAL=/dev/null`) to prevent `url.insteadOf` rewrites from sidestepping
the key.

There is **no global session file**. `~/.lanes/session.json` is gone. The workspace
is the scope.

## Many browsers at once (no lease)

Any number of tabs may drive the same workspace concurrently. Last write wins; each
tab's polls (`workspace`/`project`/`tree` on 2s/700ms intervals) reconcile the view.

## Verify

`npm run typecheck` (`tsc --noEmit`) is the only static check — there are no tests.
For UI work, run the app and exercise it in the browser.
