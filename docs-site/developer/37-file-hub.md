# file-hub: workspaces, libraries and the sync relay

`packages/file-hub` is mounted by k7's backend and is the only place workspaces live. It starts one
[file-service](./36-file-service.md) process per account and proxies to it, and it owns what is
shared between accounts or devices: the libraries, the live-sync rooms, the blob store, device
pairing and the history log.

The mount is `apps/k7/backend/src/media/fileHub.ts` (`requireFilesRoot`, `mountFileHub`), called from
`apps/k7/backend/src/media/mount.ts`. The package exports `FileHub` from `packages/file-hub/index.ts`
with the path constants `FILE_HUB_PATH` (`/api/files`), `FILE_HUB_HELLO` (`/api/files-hub`) and
`FILE_HUB_INTERNAL` (`/api/files-hub/internal`).

## STUDIO_FILES_ROOT

`requireFilesRoot()` reads `$STUDIO_FILES_ROOT` before anything listens; unset or blank, the backend
prints what to set and exits. There is no fallback, because a default would put every account's
workspaces somewhere nobody chose. Under it:

```text
$STUDIO_FILES_ROOT/
  libraries.json                  the account libraries' list
  libraries/<name>/1/ 2/ … draft/ published versions (each with library.k7x) and the admin draft
  libraries/.sync-relay/ …        the libraries' live rooms (origin)
  libraries/.sync-replica/ | .sync-follow/   the hub's own library replica
  <account-slug>/                 the account's STUDIO_HOME
    workspace/                    its workspaces
    .history/  .renders/  models/ undo journals, automatic renders, downloaded models
    .sync-relay/<workspace>/      that workspace's room: entries.jsonl, log/, snapshots/, room.json, checkpoints.json
    .sync-relay/devices.json      paired device tokens
    .sync-blobs/                  binary blobs by sha256
    .sync-remote.json             the servers this account is paired with
```

The account slug is `accountKey(email)` (`packages/file-hub/instances.ts`): a slug of the email plus
ten hex characters of its sha256, so two emails that slug alike stay apart.

Housekeeping: `staleCaches.ts` purges `.renders` and `.history` entries unused for 30 days;
`blobSweep.ts` deletes blobs no room references and nobody asked for in 7 days.

## One process per account

`Instances` (`packages/file-hub/instances.ts`) starts a file service lazily, on an account's first
request:

- **Command:** `node <tsx cli> <@studio/file-service>/src/server.ts`, or `node $STUDIO_FILE_SERVICE_ENTRY`
  when the backend is bundled (desktop, phone).
- **Environment:** an allow-list of the parent's (`packages/file-hub/serviceEnv.ts`), plus `STUDIO_HOME=<root>/<slug>`, `STUDIO_FILE_PORT` (a free
  loopback port), `STUDIO_HUB_SECRET` (random per instance), `STUDIO_LIBRARIES_HOME=<root>/libraries`,
  `STUDIO_HUB_URL`, `STUDIO_SYNC_URL` (the hub's own relay, or the paired server's with
  `STUDIO_SYNC_TOKEN` and `STUDIO_SYNC_SERVERS`), `STUDIO_RENDER_JOBS_URL` when renders are on,
  `STUDIO_MEDIATEK`, `MEDIATEK_URL`, `MEDIATEK_TOKEN`. The backend's secrets are not on the list.
- **Readiness:** `GET /health` polled every 200 ms, 60 s at most.
- **Idle:** stopped after 30 minutes without a request, unless the account is paired with a remote.
- **Crash:** no respawn loop; the instance is dropped and the next request starts a new one.

**Proxying** (`FileHub.handler()`): the user comes from a signed ticket (`x-studio-engine-token` or
`?token=`; HMAC over `{u, exp, a?}`, 12 h, minted by `GET /api/files-hub`) or from the session.
`/account/libraries…` is answered by the hub; everything else is forwarded to the account's process
with cookies and auth headers dropped and `x-studio-user`, `x-studio-admin`, `x-studio-hub-secret`
stamped. A ticket may carry `~<engineId>` to bind that engine to the account first.

## Routes

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/files-hub` | session | Mint a ticket: `{ path, ticket, admin }`. |
| `/api/files/*` | ticket or session | Proxied to the account's file service. |
| `GET`/`PUT /api/files/account/libraries`, `POST …/<name>/publish` | admin for writes | The account libraries list; publish a draft as a new version. |
| `/api/files-hub/internal/*` | `x-studio-hub-secret` of a running instance | Called by a file service: `share/checkpoint`, `share/files`, `libraries/remote`, `libraries/sync`. |
| `GET /api/public/libraries[/<name>/<v>[/file?path=]]` | none | Published library versions, for machines that fetch them. Never the draft. |
| `WS /api/sync` | device token or hub secret | The live-sync relay ([live-sync](./38-live-sync.md)). |
| `/api/sync/devices` (`GET`, `POST`, `DELETE /:id`), `GET /api/sync/devices/pair` | session | Device tokens, and the browser pairing flow that hands one to a desktop. |
| `/api/sync/remote` (`GET`, `PUT`, `POST /main`, `DELETE`) | session | Pair this machine's account with remote servers; writes refused (403) unless pairing is enabled. |
| `/api/sync/blobs/:hash` | device token or hub secret | Binary blobs: GET with ranges, resumable PUT verified against the hash, 2 GiB max. |
| `GET /api/sync/rooms` | token or secret | Workspaces that have a room. |
| `/api/sync/history/:workspace` (`GET`, `POST /checkpoints`, `GET /diff`, `POST /restore`) | session | The server log as history; a restore is submitted to the room as a batch. |
| `GET /api/sync/events` | session | Server-sent change notices, 20 s heartbeat. |

**Remote pairing** is enabled only where `STUDIO_LOCAL_USER=1` (the desktop and the phone builds,
option `remotePairing`). On the origin server no account may be paired, because the origin's
libraries follow the first paired account.

## Libraries

`packages/file-hub/libraries.ts` (`LibraryStore`):

- A library is a folder of **versions**: `1/`, `2/`… frozen, each with a `library.k7x`
  (`{ name, version, requires, notes? }`), and an admin's `draft/`. A version is never rewritten.
- A listed library missing on disk is installed from its seed (`$STUDIO_LIBRARY_SEED`: a folder of
  library folders, or `name=folder,…`), copied to a dot-named sibling then renamed into place, under
  the version its `library.k7x` declares; with no seed it starts empty. A seed declaring a version
  the machine lacks is added beside the others, at the next free number when its own is taken.
- `publish` copies the draft to `max + 1` with a new manifest. `requires` (the lowest
  `LIBRARY_LEVEL` that runs it) defaults to the previous version's.
- Which version a workspace uses is the workspace's `_library-pins.k7x`, read by `@studio/song`; the
  hub does not pin.

Distribution: on the origin, each library folder is relayed as a live room of the reserved
`_libraries` account (`libraryRelay.ts`); a paired machine follows it read-only. An unpaired machine
fetches published versions from `$STUDIO_LIBRARY_ORIGIN/api/public/libraries` (`libraryFetch.ts`).

## Environment

| Variable | Read by | Meaning |
|---|---|---|
| `STUDIO_FILES_ROOT` | backend mount | Required data root. |
| `STUDIO_FILES_WATCH` | backend mount | `1` restarts every file service when the file-service source changes (development). |
| `STUDIO_LOCAL_USER` | backend mount | `1` enables remote pairing. |
| `SESSION_SECRET` | backend mount | Derives the ticket key; without it tickets die with the process. |
| `STUDIO_FILE_SERVICE_ENTRY` | `instances.ts` | Bundled file-service entry. |
| `STUDIO_LIBRARY_SEED` | `libraries.ts` | Where new libraries are seeded from. |
| `STUDIO_LIBRARY_ORIGIN` | `libraryFetch.ts` | Origin to fetch published library versions from. |

## Tests

The tests sit beside the sources in `packages/file-hub/` (`fileHub.test.ts`, `libraries.test.ts`,
`syncRelay.test.ts`, `syncRelayFrames.test.ts`, `syncPairing.test.ts`, `syncMove.test.ts`,
`blobStore.test.ts`, `history.test.ts`…) and exercise the hub, its relay and its stores over loopback ports and temporary data roots.
