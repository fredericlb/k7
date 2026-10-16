# file-service: one process per account

`packages/file-service` is the only code that touches a workspace's files. k7's backend has no file
operation of its own: `@studio/file-hub` starts one file-service process per account and proxies
`/api/files/*` to it ([file-hub](./37-file-hub.md)). An engine's machine runs no file service; what the
server needs from that machine is a job its supervisor runs over the tunnel.

One process per account, rather than one shared process, keeps an account's state — its workspaces,
its engine link, its caches, its undo journal, its live-sync replica — in a process of its own that
can be stopped when idle and restarted without touching anyone else.

## Starting

`packages/file-service/package.json` declares `bin: studio-file-service` → `src/server.ts`; it runs
under `tsx` from source (`npm start`). It is not meant to be started by hand: the hub sets its
environment.

Boot (`packages/file-service/src/server.ts`): capture the service log, install the builtin plugins
(`@studio/k7-plugins/server`), install the process guards (`src/background.ts`: an uncaught exception
exits so the parent restarts it), load `src/hosted.ts` (which throws if `STUDIO_HUB_SECRET` is empty),
then listen on `127.0.0.1` only. Once listening it creates the workspace root, attaches live capture
to every workspace, mirrors the bundled demos into an "Examples" workspace, and starts the media
prefetch and the idle-link pruning.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `STUDIO_FILE_PORT` | `8770` | Listen port (the hub allocates a free one). |
| `STUDIO_HUB_SECRET` | required | Shared secret with the hub; every gated request must carry it. |
| `STUDIO_HOME` | `~/.k7` | The account's state root; workspaces live in `<STUDIO_HOME>/workspace`. |
| `STUDIO_HUB_URL` | none | The hub's internal endpoint, for library sync and shares; without it those calls do nothing. |
| `STUDIO_LIBRARIES_HOME` | `<STUDIO_HOME>/libraries` | Where the account's libraries are read from (the hub points every account at one shared folder). |
| `STUDIO_SYNC_URL`, `STUDIO_SYNC_TOKEN`, `STUDIO_SYNC_SERVERS` | none | The live-sync relay(s); a token means this is a paired machine. |
| `STUDIO_LIVE_SYNC` | on | `0` turns live capture off. |
| `STUDIO_K7X` | unset | The k7x switch ([k7x](./34-k7x.md)). |
| `STUDIO_DEMOS` | a `demos/` folder found upwards | The demo songs mirrored into Examples. |
| `STUDIO_MEDIATEK`, `MEDIATEK_URL`, `MEDIATEK_TOKEN` | none | The media library's folder and HTTP endpoint. |
| `STUDIO_RENDER_JOBS_URL` | none | The server's render machine. |
| `DIRT_SAMPLES`, `STRUDEL_SAMPLES` | none | Extra sample banks for pattern lanes. |

## Authentication

The process trusts only its hub. `x-studio-hub-secret` is compared in constant time
(`requireHubSecret`); everything else is a header the hub stamps after authenticating the user:
`x-studio-user` (the email, required), `x-studio-workspace` (resolved to a `Workspace`, 404 if
unknown), `x-studio-admin` (`1` for an admin). The names are in `packages/web-protocol/types.ts`.
`requireRootOwner` (`src/owner.ts`) holds an account's workspaces to the one recorded owner.

## HTTP API

There is no WebSocket server and no event stream here: the browser polls (`GET /workspace` every
couple of seconds, `GET /revision`). The process is a WebSocket *client* of the engine, of the
engine machine's jobs socket, and of the sync relay.

### Ungated

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | `{ ok: true }` — what the hub polls before forwarding. |
| GET | `/media` | A workspace file for `<video>` (`user`, `workspace`, `path` in the query; secret checked inline). |

### Hub-only

| Method | Path | Purpose |
|---|---|---|
| POST | `/hub/engine` | Bind or unbind this account's engine (`url`, `jobsUrl`, `engineId`, `engineName`). |
| POST | `/hub/cold-chain` | Resolve a cold (offline) chain run. |

### Account and workspaces (no workspace header)

| Method | Path | Purpose |
|---|---|---|
| GET, POST | `/workspaces` | List; create `{ name }` (pins the libraries). |
| POST | `/workspaces/remove`, `/workspaces/copy-project`, `/workspaces/bench` | Remove a workspace; copy a project between workspaces; open the bench. |
| GET | `/workspaces/projects`, `/workspaces/surfaces`, `/workspaces/sync` | Every project (home page); projects a second device can open; where each workspace lives. |
| POST | `/workspaces/sync/download`, `/move`, `/copy` | Move or copy a workspace between servers. |
| GET | `/engine/served` | The project the engine holds for this user. |
| GET | `/plugin-params`, `/plugin-native-ui` | A scanned plugin's parameters; its native window. |
| GET, PUT, POST | `/account/live-chains`, `/account/cold-chains[/:which]`, `/account/cold-chains/download`, `/account/models/:id` | Account-level chain choices and model downloads. |
| * | `/mediatek/*` | The media library cache (`src/routes/mediatek.ts`). |
| POST | `/render` | Render a document and stream the file back (`src/routes/render.ts`). |

### Inside a workspace (`src/routes/files.ts`)

| Group | Routes |
|---|---|
| State | `GET /workspace` (the poll; also prewarms the engine), `GET /revision`, `GET /project`, `GET /project-doc` (timeline view), `GET /engine-doc` (the compiled `ProjectDoc`), `GET /graph` (`WebGraph`), `GET /video-doc`, `GET /surfaces`, `GET /project-errors`, `GET /video-errors`, `GET /hints`, `GET /tree`, `GET /workspace-tree` |
| Files | `GET /file`, `PUT /file` `{ path, content }`, `POST /upload`, `POST /folder`, `POST /rename`, `POST /move`, `POST /entry/delete` (to the recycle bin), `POST /fmt`, `POST /migrate-k7x` |
| Projects | `POST /project/create` `{ shape, name }`, `POST /open` `{ path }`, `POST /project/delete`, `POST /project/rename`, `POST /import-project`, `POST /import-upload` |
| Modules | `POST /module`, `POST /module/clone`, `POST /node`, `POST /library/move`, `GET /module-libraries`, `GET /module-catalogue`, `GET /base-modules`, `GET /module-ui`, `GET /module-engines`, `GET /module-base`, `POST /module-base/snapshot`, `GET /presets`, `GET /consoles`, `GET /io-ports`, `GET /library-chains`, `GET /library-assemblies` |
| Commands | `GET /commands`, `GET /complete`, `POST /command` `{ line, at?, want? }` → `{ output, refused?, rev?, changed?, graph? }` |
| History | `GET /history`, `GET /history/entries`, `POST /undo`, `POST /redo` |
| Engine | `POST /engine/project` (a browser-built doc), `POST /engine/unload`, `POST /engine/sync/retry`, `POST /auto-freeze/thaw`, `GET /project-plugins`, `GET /project-compat`, `POST /models/download` |
| Audio views | `GET /waveform`, `POST /waveforms/prewarm`, `GET /waveforms/status`, `POST /waveforms/cancel`, `POST /preview` |
| Sharing, export | `GET /export` (`wav`/`mp3`), `POST /share/k7`, `POST`/`GET /share/link` |
| Sync | `GET /sync/log`, `GET /sync/project`, `GET /sync/conflicts`, `POST /sync/conflicts/:id` |
| Misc | `GET /preferences`, `PUT /preferences/vim`, `GET /playlists`, `GET /references`, `GET /logs` |

## Writes, revisions and the journal

`PUT /file` and every command run inside `Workspace.recordChange(label, mutate)` (`src/workspace.ts`):
live capture is held for the window, the tree is snapshotted before and after (texts, binaries by
`size:mtime`), and the difference is pushed onto the project's undo journal
(`src/history.ts`, `ProjectHistory`, at most 1000 entries, kept under `<STUDIO_HOME>/.history`, outside
the project). Binary pre-images are saved before they are overwritten; on a bound engine machine they
are kept there (`src/historyKeeper.ts`).

The **revision token** is how every derived view knows it is stale: a count of mutations plus the
newest mtime among the active project's `.yaml`, `.k7x` and `.vstpreset` files (and the machine's
preferences). The compiled `ProjectDoc` and the `WebGraph` are memoised on it.

## From a save to the engine

The **active project** is the one a ▶ opened (`POST /open` → `setActiveProject`), remembered per
workspace under `<root>/.active-projects/`. For it, `src/engineLink.ts`:

1. keeps one `EngineClient` socket per engine session, reconnecting with backoff;
2. on a trigger — open, a `PUT /file` inside the project, undo/redo, a command that reloads, the poll
   when nothing is served — calls `startEngineForActive`, which watches the project's `*.strudel`
   files (chokidar) and pushes the document;
3. `pushProject` compiles with `loadProject` (memoised on the revision);
4. `sendWhenSynced` (`src/engineSync.ts`) copies to the engine's machine every file the document
   names that the machine does not hold yet, as one `sync` job over the jobs socket; a failed copy
   holds every document back until `POST /engine/sync/retry`;
5. sends the document, then warms it up (`src/engineLoad.ts`): wait until the session is loaded, play
   it silently for half a second, restore. The phases are reported through `GET /workspace`.

Module folders are watched separately (`src/moduleWatch.ts`) to invalidate the module caches;
live-sync capture has its own recursive watcher.

## Live sync inside the service

| File | Role |
|---|---|
| `src/liveSync.ts` | Attaches capture to each workspace and links it to its server's room through a `Replica`. |
| `src/liveCapture.ts` | Watches the workspace (100 ms quiet window, 5 s sweep) and turns changes into batches of file operations; writes arriving from the room are recorded first so they are not echoed. |
| `src/liveRelay.ts` | One WebSocket per server for all workspaces: `hello`, `batch` out; `welcome`, `seq`, `error` in; resends unconfirmed batches after reconnecting, and sends a batch only once its blobs are uploaded. |
| `src/liveServers.ts` | The list of sync servers from the environment, main first. |
| `src/liveLedger.ts`, `liveBlobs.ts`, `liveBlobTransfer.ts`, `liveConfirmed.ts`, `liveLog.ts`, `liveMove.ts` | What is known about each file, binary blobs in flight and their transfer, the confirmed mirror, the per-batch log, moving a workspace between servers. |

## Tests

`npm test` (vitest, `pool: "forks"`, 30 s timeouts; `packages/file-service/vitest.config.ts` points
`STUDIO_HOME` and `STUDIO_MEDIATEK` at non-existent temp folders). No test spawns `server.ts`, which
would need a hub secret: tests mount `filesRouter` on an inline express app with
`req.ws = new Workspace(tmpRoot)` — see `src/writePushes.test.ts`, `src/commandWant.test.ts`,
`src/migrateK7x.test.ts`. Fake engines, jobs sockets and relays listen on port 0 where needed.
`src/graphDoc.golden.test.ts` snapshots the `WebGraph`.
