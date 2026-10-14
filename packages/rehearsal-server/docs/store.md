# The rehearsal store: SQLite, and sheets on disk

The rehearsal pages' rows (sessions, moments, markers, releases, versions, pages, singing
exercises, songs, favourites) live in one SQLite file, `k7.db` under `K7_DATA_DIR`. A song's
sheets are plain files beside it, under `sheets/`. `../src/sqlite.ts` is the store and `../src/db.ts`
is the one this process opens. The server, the desktop and the phone run the same store, so a
rehearsal feature behaves the same wherever it runs.

## Why SQLite, in this process

The store has one client, this package, inside st0's backend, which runs as one process. A database
server would bring a container, a superuser, credentials, a network hop with its timeouts and a
schema to reconcile, and buy nothing a single in-process client needs. `node:sqlite` is part of
Node, so there is no package to install and nothing to start. st0's backend already keeps the shares'
comments in SQLite for the same reasons (`../../../apps/st0/backend/docs/media/comments.md`).

The cost is the single writer. A second backend process on the same volume would need the store to
move out again.

## A row is a JSON document

Each row is one JSON document, keyed by its collection and id. A field added to `../src/schema.ts`
therefore needs no migration: old rows simply lack it. Such a field reads as its type's zero value
(`""`, `0`, `false`), taken from `schema.ts`, because `store.ts` relies on getting a value rather
than nothing. A filter is an IN-list per field, matched with `json_extract`.

An id is a random 15-character string. Rows imported from PocketBase keep their PocketBase ids,
which is what keeps the references between rows intact (a sheet's song, a song's `SheetMeta`).

## Sheets are files, not BLOBs

A sheet's bytes are written to `sheets/<id>` under a temporary name and moved into place, and the
`sheets` table keeps only its song, name and type. The file is written before its row, so a row
never names a file that is missing. Deleting a song deletes its sheets, rows and files together.

Files rather than BLOBs keep the database small enough to copy and back up quickly, let a route
stream a sheet straight from disk with Range support, and let a person see the sheets with
ordinary tools.

## Backups

`k7.db` runs in WAL mode, so copying the file while the backend writes it can capture half a
transaction. Back it up with `sqlite3 k7.db "VACUUM INTO 'backup.db'"`, or stop st0 first. The
`sheets/` folder is ordinary files and can be copied as it is.

## The one-time import from PocketBase

The server's rows used to live in PocketBase. At boot, when `POCKETBASE_URL`, `_EMAIL` and
`_PASSWORD` are set and the store holds no row, `../src/pocketbaseImport.ts` copies every
collection `schema.ts` names, plus every sheet with its bytes, keeping the ids. It never writes to
PocketBase.

- **Routes wait for it.** Every rehearsal route waits until the import is done, so nothing is
  written into a store that is only half filled. Only the rehearsal paths wait: st0's other `/api`
  routes share the process and never do.
- **All rows or none.** The sheets are written first, then every row in one transaction. A
  PocketBase that fails partway leaves no row behind, the routes answer 503 saying why, and the
  next start tries again. A sheet written again on a retry replaces the earlier copy.
- **Only the fields `schema.ts` names.** PocketBase's own columns (`created`, `collectionId`…) and
  any field abandoned since are left behind.

Once st0 has logged `rehearsal: imported …`, the `pocketbase` service, its volume and the three
variables can be removed (`../../../docker/docker-compose.yml`).
