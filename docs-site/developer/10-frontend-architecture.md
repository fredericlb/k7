# k7 frontend architecture

`apps/k7/frontend` is the browser app: React 19, Vite, Tailwind v4 and `@frediverse/ui`, consumed with every `@studio/*` package as raw TypeScript source. It is the only app that opens a project. This page is the map of its shell; the timeline, the chains graph, the desk and the picture have their own sections.

## Boot: one address, one branch

| File | Role |
|---|---|
| `apps/k7/frontend/src/main.tsx` | Parses the address with `parseLaunch` and dynamically imports **either** the desktop tab strip (`src/tabs/mountStrip.tsx`) or the app (`src/appMain.tsx`). Both arms are dynamic so neither pays for the other. A chunk that fails to load reloads the page once (`src/chunkReload.ts`). |
| `apps/k7/frontend/src/appMain.tsx` | Decides what the address is, **from the address alone**, and mounts the matching stack under one `BrowserRouter` and the `LocaleProvider`. |

`appMain.tsx` recognises, in order:

1. a home route (`/libraries`, `/settings`, `/tasks`, `/media/…`, `/rehearsal/…`, or `/`) — the home page and its routes, no project;
2. a **share** (`/@shares/<token>.k7`) — `SharedGate` then `App` with a frozen snapshot, no account;
3. a rehearsal **public page** (`/rehearsal/@<nametag>`) — read before sign-in;
4. `/external` — the second device's menu of surfaces (`src/components/ExternalIndex.tsx`);
5. anything else naming a project — `AuthGate` → `EngineGate` → `ProjectGate` → `App`, or `ExternalSurface` when the address ends in `/@external/<surface>`.

The gate stack is the reason no screen ever has a half-configured transport: `AuthGate` (`src/components/AuthGate.tsx`) requires a session, `EngineGate` picks and leases an engine (Engines section), `ProjectGate` (`src/components/ProjectGate.tsx`, wrapping `@studio/project-shell`'s gate — see [project-shell](./11-project-shell.md)) resolves the workspace, waits for sync, opens the project and configures the file transport. Only then does `App` mount, keyed by `workspace/project` so switching remounts cleanly.

The project is the router's **basename** (`projectBasename`), so the router can only write below it: `src/routes.ts` cannot rewrite the project away, and a reload re-reads the address. There is no session storage of "the current project".

`appMain.tsx` mounts no `React.StrictMode`: its double mount loses the viewport's WebGL context on Firefox.

## `App.tsx`: the shell

`apps/k7/frontend/src/App.tsx` is the editor shell. It is over 5000 lines; it holds the wiring between panes and is the first candidate for splitting. Most of its logic already lives in pure modules beside it, each with a test:

| Concern | Module |
|---|---|
| Panes, panels, URL state | `src/routes.ts`, `src/useViewRoute.ts`, `src/shellMeta.tsx` |
| Keys | `src/keys.ts`, `src/hooks/useCommandKeys.ts` |
| Palette catalogue, local commands | `src/palette.ts`, `src/localCommands.ts`, `src/argOptions.ts`, `src/fuzzy.ts`, `src/recentCommands.ts` |
| Command bar form | `src/commandFill.ts`, `src/components/CommandBar.tsx`, `src/components/CommandParams.tsx` |
| Right-click menu | `src/contextMenu.ts`, `src/menuTabs.ts`, `src/menuConfirm.ts`, `src/components/ContextMenu.tsx` |
| Per-person command layer | `src/commandPrefs.ts`, `src/components/CommandsSettings.tsx` |
| Overlays and Escape | `src/popins.ts` |
| Reload scoping | `src/reloadScope.ts` |
| Optimistic edits | `src/pendingEdits.ts` |
| Sync | `src/syncFeed.ts`, `src/syncConflicts.ts`, `src/syncHistory.ts`, `src/hooks/useRevision.ts`, `src/hooks/useConflicts.ts` |

### Layout: one page, never a split

The vocabulary is declared in `src/routes.ts`:

- a **pane** is one of `editor | timeline | turntables | mastering | chains`; exactly one is the page (`full`), never null;
- a **panel** is one of `event | graph | mix | logs`, drawn under the page.

`viewPanes(declared)` turns what the project declares in `surfaces/` into the pane **ring** (`Tab`'s cycle) and the **fullscreen** list. That one function closes the header buttons, the number keys, `ui <pane>` and the phone menu together, so a project without a `timeline` surface has no timeline anywhere. The project's home page is the timeline when declared, else the first ring pane. The viewport is not a pane: it is a `FloatingWindow` over the page.

Every pane is mounted once and **hidden, never unmounted**. This keeps the editor's CodeMirror undo history, the desk's document and the viewport's GL context alive, and is what lets the editor be restyled into a popin. The cost is that a fault in a hidden pane would unmount everything, which is why each pane is wrapped in `src/PaneBoundary.tsx`; its card resets on the reload key.

`useViewRoute` mirrors `{full, panel, help, builder}` into the URL both ways: `/<pane>`, `?panel=`, `/docs` (or `/help`), `/chains-builder/<ref>`. `toPath` only owns `panel` among query parameters and keeps the others.

The right column (`rightPanel` state) holds one of settings, playlists, references, tasks, history, share, comments, conflicts.

### Commands are the only road

Every button, menu entry and key dispatches a **command line** through `runCommand`. `runCommand`:

1. logs the line and remembers it for the palette's recency ranking;
2. offers it to `runLocalCommand` (the `ui` verbs, the transport verbs answered over the engine socket, the selection verbs, the file-tree verbs, undo/redo, export and share) — see [the commands package](./12-commands-package.md) for which lines are local;
3. otherwise POSTs it to the file service's `/command`, asking for the graph only when a view of the graph is on screen;
4. shows the output on the status line, as a **refusal** (amber) when the reply says `refused`;
5. adopts the revision token the reply carries **before** bumping the reload, so the `/revision` poll does not reload a second time;
6. bumps the reload key with the list of files the command wrote.

Mixer and knob edits go through `quietCommand`, which asks for no graph and does not bump the reload. A one-shot edit that changes the lanes is shown at once from `pendingOf` (`src/pendingEdits.ts`) and dropped when the next compiled document arrives, or taken back on a refusal.

### Reload scoping

A reload carries the files a command wrote (`ChangedFile[]`, or null for "unknown"). `src/reloadScope.ts` derives scoped keys (`chainsKey`, `surfacesKey`, `audioKey`) so a view refetches only when a reload could concern it.

### One revision poll

`src/hooks/useRevision.ts` is a refcounted poller of the file service's `/revision` token: one request every 2 s for the whole tab however many consumers subscribe, slowed to 30 s while the sync event stream (`src/syncFeed.ts`, one `EventSource` on `/api/sync/events` per page) pushes notices. Consumers react to the token, never to their own timer. Polls stop while the tab is hidden (`src/visiblePoll.ts`).

### State that does not belong to React

The engine's live state (playhead at ~20 Hz, meters, plugin params) lives in external stores from `@studio/engine-browser` (`EngineStore`, `PluginParamsStore`), read with `useStoreState` selectors. `App` deliberately does not subscribe to the playhead; the clock is its own component (`TransportClock` in `src/shellMeta.tsx`).

## The three servers

The browser talks to three servers, through `apps/k7/frontend/src/api.ts`:

| Destination | How | For |
|---|---|---|
| k7's backend, same origin | `/auth/*`, `/api/*`, cookie | sign-in, the account's preferences, the AI settings, the media library, the engine registry, sync history and events |
| The account's file service | absolute URL from the engine probe, header-authenticated ticket (`@studio/project-shell/fileApi`) | every file and project operation: tree, files, `/command`, `/complete`, `/commands`, compiled document, graph, `/revision`, undo, conflicts |
| The engine | WebSocket (`src/hooks/useEngineLink.ts`) | transport, meters, live params, pairing |

See [Frontend and backend boundary](./19-frontend-backend-boundary.md).

## Tests

`npm run test` in `apps/k7/frontend` runs vitest over the pure modules (keys, routes, palette, command form, context menu, local commands, message catalogues…). Nothing mounts a component: a change to what is drawn or how a gesture feels has to be checked in the running app (`npm run dev` at the root). `npm run typecheck` compiles the paraglide catalogues first.
