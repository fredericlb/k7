# AGENTS.md — l8

A **text-based DAW**. Your song is a folder of YAML files; the terminal or a web editor
is your studio.

**This directory is the web editor, and only that.** The engine (`engine/moteur`), the
tray (`engine/capot`) and the brain packages (`packages/*`, all `@studio/*`) moved out
when they stopped belonging to l8 alone — the repo-root `AGENTS.md` holds the map of
the whole audio side. Two workspaces live here:

| Package | Role |
|---|---|
| `frontend` (`l8-frontend`) | React + Vite + Tailwind v4 + `@frediverse/ui`. The visual editor: YAML code editor (CodeMirror), timeline, chains graph, video compositor. |
| `backend` (`l8-backend`) | Express — **the engine registry only**, plus verifying the session st0 mints. It has no file routes and no auth routes. It knows *who you are* and *which engines exist*, never what is on any disk. |

Dev ports: **frontend 5223, backend 8789**, served over TLS at `https://studio.test/l8`
by the repo-root Caddyfile.

## The browser talks to THREE servers

| | `backend` | `@studio/file-service` | `engine/moteur` |
|---|---|---|---|
| runs on | the hosted machine | the **engine's** machine | the engine's machine |
| owns | the engine registry (auth is st0's) | `~/.studio/root/<user>/<workspace>` — every file op | audio playback |
| reached | same-origin (`/api`, `/auth` via the Vite proxy) | **cross-origin, direct** (CORS-gated) | **WebSocket, direct** |
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
(`studio.test/<service>`), so there is one session cookie — `studio.sid`, signed with the
`SESSION_SECRET` in `env.yaml`'s `common` — and one `redirect_uri` to register with the IdP.
That `redirect_uri` is `<origin>/auth/callback`, with **no prefix**, so it can only be served
by the service that has no prefix: st0, which answers the origin root. This backend owned it
while the bare origin merely redirected here, and now passes `mountRoutes: []` exactly as m9
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
| `commandBar.md` | the step-by-step palette and module picker |
| `docExamples.md` | how `docs.test.ts` keeps the shipped documentation honest |

### Three data paths (`src/api.ts`)

1. **Backend** (same-origin `/api/*`) — auth + engine registry only.
2. **File service** (cross-origin, absolute URL) — everything file-shaped (`/tree`,
   `/file`, `/hints`, `/command`, the compiled `/project-doc` and `/graph`). Bare
   paths, no `/api` prefix.
3. **Engine WebSocket** (`@studio/engine-browser`, wired by `src/hooks/useEngineLink.ts`) —
   live transport and meters. Don't route transport through either server.

### Layout: panes, not tabs

`App.tsx` shows three panes at once — editor (left), timeline (top-right), chains
(bottom-right). Each pane is **mounted exactly once, in every layout**. `hidden` takes
a pane off screen; nothing unmounts. Two views: `global` (chains graph) and `video`
(video compositor). `full` sits on top of a view to fullscreen one pane.

The vocabulary is three words, not two, and `src/routes.ts` is where they are declared —
read it before changing layout. A **pane** is one of four (`editor | timeline | chains |
viewport`) and is what `full` fullscreens. A **panel** is one of five (`editor | mixer |
graph | docs | logs`) and is what the editor column shows. A **view** is the arrangement of
panes. All three are URL state (`src/hooks/useViewRoute.ts`); see
`frontend/docs/shellRouting.md`.

### Commands are the CLI's, verbatim

The command bar calls `/complete` and `/command` on the **file service**
(`packages/file-service/src/routes/files.ts`), which dispatch through `@studio/commands`.
That package owns the SID → handler mapping and is the only place a verb is defined. Add a
feature there, not here. Web-local commands are only the shell's own view state (tabs,
close, edit sequence/clip in `LOCAL_COMMANDS`).

### Every shortcut names a command (`src/keys.ts`)

Keys are looked up in `KEYS` and the named command runs through `runCommand`. `;`
focuses the command bar (`@command`). Bindings can be conditional, ordered, and
interpolate conditions into command names (`f` → `{focus_pane}`).

### Editor, chains, timeline, video

- **Editor** — `@uiw/react-codemirror` with `@studio/ui-editor` for YAML support and a
  hint-driven completion source. Vim mode is on by default (a global preference in
  `~/.studio/preferences.yaml`); `:w` is wired to the tab's `onSave`.
- **Modules** — `@studio/ui-module-builder`, the same component the médiathèque runs,
  as a full-screen overlay over the shell. It is reached by the **Builder** button on a
  module file's editor toolbar, not by opening the file: `module.yaml` must still open
  its text, because that is the path a shared module forks through. `src/api.ts`'s
  `moduleStore` is the seam — see that package's `docs/store.md`, in particular why a
  save can come back saying it landed somewhere else. The catalogue itself is still the
  médiathèque's (`MEDIATEK_URL`); this edits the modules a project can see.
- **Chains** — dagre (`@studio/ui-chains`) for layout, `@studio/ui-chains-react`'s
  `DomChains.tsx` for drawing: HTML nodes plus one SVG cable layer. **Never hand-roll layout
  or edge routing.** dagre owns both; the renderer consumes its numbers. Pan/zoom is one CSS
  transform on the `.dgx-world` wrapper. Both halves live outside this app because the
  médiathèque and the decks draw the same view — see that package's `docs/hosting.md` for
  what a host owes it. l8 is the demanding host: the command bar, context menu and edge
  inserts are optional props the other two pass nothing for.
- **Timeline** — vim-style: `hjkl` movement, `v` for visual selection, `z`/`Shift+z`
  for the zoom stack, `m`/`s` for mute/solo (which rewrite `tracks/*.yaml`, not a
  session flag). Selection and zoom are a stack; the innermost entry describes the
  view. Unlike chains, this one stays l8-only.
- **Video** — `@studio/ui-eyes`, a WebGL compositor. One `<video>` per layer, not per
  clip. The `video` view is the default for songs with video tracks (`autoVideoRef`).

## The backend in detail

**Two source files**: `server.ts` and `types/express.d.ts`. That is the whole thing — the
registry itself is `@studio/engine-registry`, shared with st0 and the decks because each
service holds its own copy of it (that package's `docs/shared.md` says why). Don't look for
a `registry.ts` here.

- Browser-facing registry routes (`/api/engines`, `/api/engine/*`) require a session.
- Engine-facing routes (`/api/registry/{heartbeat,deregister}`) stay open — that is the
  supervisor, authenticated by its own token.
- The Vite dev server proxies `/api` to the backend, and **not** `/auth` — Caddy sends
  that to st0 origin-wide, so a proxy here would forward to routes that no longer exist.
- Auth and engine assignment are separate concerns: the assignment ("in use" badge) is
  a per-engine lease **across users**, not per-workspace across tabs.

## l8 is opened ON a project — it does not pick one

**This app no longer owns workspaces.** st0 owns the repositories (`apps/st0/docs/projects.md`)
and links here with two parameters:

```
/l8/?repo=git%40host%3Ame%2Fsongs.git&project=songs%2Ffirst
```

`ProjectGate` resolves that repository to a folder on the chosen engine's machine — asking
`GET /workspaces/by-repo`, and cloning it with a visible progress bar if that machine has
never seen it — then opens the project. Arriving with no parameters redirects to st0's
`/projects`; there is deliberately no fallback picker.

`@studio/project-shell/launch` reads those parameters **at import time** — `main.tsx` imports
it for that side effect alone — because `useViewRoute` rewrites the address from `routes.ts`
alone within a frame of the first render and would otherwise drop them. Read
`packages/project-shell/docs/launch.md` before touching it.

The gate itself is that package's too, and m9 mounts the same one; `components/ProjectGate.tsx`
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
