# Frontend and backend boundary

The k7 editor in the browser talks to three servers, and each request has exactly one right destination. Getting it wrong shows up as a 401 that explains nothing or as a file op that silently lands on the wrong machine.

| | k7 backend | account file service | engine |
|---|---|---|---|
| Code | `apps/k7/backend` | `packages/file-service`, started per account by `packages/file-hub` | `engine/k7-runtime` |
| Runs | the hosted machine (or the device itself, standalone) | beside the backend, one process per account | the engine's machine |
| Owns | `/auth/*`, the account's preferences, AI settings, media library, shares, engine registry, sync relay and history | the account's workspaces: every file op, the command dispatch, compile, revision, undo, conflicts | playback, transport, meters, live params |
| Reached | same origin, `/api/*` and `/auth/*` | through the backend's hub, at the base URL the engine probe returns; never directly | WebSocket, direct when allowed, else relayed through the origin |
| Auth | the `studio.sid` cookie | a hub ticket in headers (`<ticket>~<engineId>`), minted from the session; the cookie is never sent | engine token |

## In the frontend

`apps/k7/frontend/src/api.ts` is the one typed client:

- auth: `/auth/me`, `/auth/login?return_to=…`, `POST /auth/logout` — spelled at the root, since k7 is the service with no prefix;
- `engines` (`engineAccess` from `@studio/engine-browser/access`): the registry, probe, lease and relay, plus the account preferences (`prefs`, `patchPrefs`) at k7's own root;
- `api.*`: the file service, built on `@studio/project-shell`'s `projectApi` and `fget`/`fsend`, whose base and headers are set once by the gate;
- `aiOrganize`: `/api/ai/*`.

Other same-origin calls: `src/syncFeed.ts` (one `EventSource` on `/api/sync/events`), `src/syncHistory.ts` (`/api/sync/history/<workspace>`: list, checkpoints, diff, restore).

The conflicts list and its settle (`/sync/conflicts`) go to the **file service**, which holds the workspace's replica; the history and the event stream go to the **backend**, which holds the relay's ordered log.

## The file service routes the shell uses most

All in `packages/file-service/src/routes/files.ts`:

| Route | For |
|---|---|
| `GET /workspace` | The workspace, the active project, the last take, engine sync and load progress (polled) |
| `POST /open` | Hand a project to the engine (the ▶ in the tree) |
| `GET /tree`, `GET/PUT /file`, `/folder`, `/rename`, `/move`, `/entry/delete` | The file tree and editor |
| `GET /commands`, `GET /complete`, `POST /command` | The command layer ([the commands package](./12-commands-package.md)) |
| `GET /revision` | The change token every view keys its reloads on |
| `GET /preferences`, `PUT /preferences/vim` | The **machine's** preferences |
| `GET /sync/conflicts`, `POST /sync/conflicts/:id` | Open sync conflicts, settle one |
| `GET /sync/project` | Whether a project is fully arrived, which `/open` waits for |

## Two kinds of preferences

| Kept by | Holds | Why there |
|---|---|---|
| k7 backend `/api/preferences` (per account) | the remembered engine id, command prefs (names, icons, keys, menus, order), playback target | follows the person to every browser |
| k7 backend `/api/ai/settings` (per account) | Claude key and model | the key must be write-only from the browser |
| file service `/preferences` (per machine) | vim mode, audio device, channel labels | belongs to the rig, not the person |
| browser `localStorage` | interface language, recent commands, viewport window placement, profiling switch | per-browser conveniences |

## Sessions and tickets

The hub mints the file service's ticket from the session; it ages (twelve hours), and `fileApi.ts` renews it once on a 401 through `engines.freshTicket()`. The engine WebSocket URL is a function rather than a string because a relayed URL carries a one-minute ticket. Logging out anywhere logs out of every studio app, and the backend being down means nobody can sign in to any studio app.

## Where to add something

- A new **verb** on project files: `packages/commands`, never a new route ([Adding a command](./13-adding-a-command.md)).
- A new **file-shaped** read the views need: a route in `packages/file-service`, a function in `@studio/project-shell` if z0's editor needs it too, else in `apps/k7/frontend/src/api.ts`.
- A new **account-level** setting: k7's backend (`prefsSchema` in `server.ts`) and `K7Prefs` in `api.ts`, together.
- Anything about **live audio**: the engine protocol (Engines section).
