# The rehearsal store: SQLite, and sheets on disk

The rehearsal pages' rows (sessions, moments, markers, releases, versions, pages, singing
exercises, favourites) live in one SQLite file, `k7.db` under `K7_DATA_DIR`. The songbook's songs
are not rows: they are library song folders (`../../mediatek/docs/songbook.md`), and only each
person's star on one is kept here. `../src/sqlite.ts` is the store and `../src/db.ts`
is the one this process opens. The server, the desktop and the phone run the same store, so a
rehearsal feature behaves the same wherever it runs.

## Why SQLite, in this process

The store has one client, this package, inside k7's backend, which runs as one process. A database
server would bring a container, a superuser, credentials, a network hop with its timeouts and a
schema to reconcile, and buy nothing a single in-process client needs. `node:sqlite` is part of
Node, so there is no package to install and nothing to start. k7's backend already keeps the shares'
comments in SQLite for the same reasons (`../../../apps/k7/backend/docs/media/comments.md`).

The cost is the single writer. A second backend process on the same volume would need the store to
move out again.

## A row is a JSON document

Each row is one JSON document, keyed by its collection and id. A field added to `../src/schema.ts`
therefore needs no migration: old rows simply lack it. Such a field reads as its type's zero value
(`""`, `0`, `false`), taken from `schema.ts`, because `store.ts` relies on getting a value rather
than nothing. A filter is an IN-list per field, matched with `json_extract`.

A row's type is read off the same file: `FieldsOf<"Songs">` is what `schema.ts` lists for that
collection, and `db.ts` hands each collection's rows back under it, so a field added to the schema
is typed in every reader at once and a field misspelt in the store does not compile. The package is
type-checked strictly and its host reads its sources, with no declaration file between them.
A collection the store stops holding is named in `RETIRED_COLLECTIONS` (`schema.ts`), and its rows
are deleted when the file opens: an older file would otherwise carry them forever, read by nothing.

The connection is synchronous, so a lookup that scans a whole collection blocks every other
request for as long as it takes. The fields the store looks rows up by (`INDEXED_FIELDS` in
`../src/sqlite.ts`: the uids and owner ids) each carry an **expression index** on
`(coll, json_extract(fields, '$.<field>'))`, created when the store opens. SQLite uses such an index
only when the query spells the same expression, so the field path is written into the SQL rather
than bound as a parameter; the field name is checked as a plain word first. A field added to the
lookups is added to that list, and `sqlite.test.ts` checks the query plan of each.

A listing that names its fields reads only those, each extracted with `json_extract` in the SQL:
the rest of the row, a session's or a song's envelope among it, is never handed to JavaScript nor
parsed. A text the list only needs to know is there (a song's lyrics, its tablature) is read as a
`filled` flag, computed in SQL. A row asked for by id (a moment, a marker) is read by its primary
key and its owner or session checked afterwards, never found by scanning its owner's rows.

## Every call is synchronous, and a multi-row write is one transaction

`node:sqlite` is synchronous, and so is the store's API: nothing awaits between two statements, so
`inTransaction` takes a synchronous function and refuses one that returns a promise. An `await`
inside an open transaction would let another request's writes join it, and its rollback undo them.
Every write that spans several rows (an insert of many, a session's deletion with its markers, a
release's with its versions, a new default version) runs in one transaction, so it
lands whole or not at all, and pays one sync to disk instead of one per row. A transaction opened
inside another joins it. Work that must await (a file pushed to or removed from the médiathèque)
happens before or after the transaction, never inside it.

The connection runs `synchronous = NORMAL`: under WAL a power cut can lose the last commits but
never corrupts the file, and a commit no longer waits for its own fsync. Statements are prepared
once per SQL text and kept for the life of the connection; the texts are few, since values are
always bound.

## The songbook list carries no texts

`GET /api/songs` answers one row per song, read from the library's catalogue: its names, its flags,
whether it has lyrics, a tablature and sheets, and nothing of their content. A song's texts come from `GET /api/songs/:sid`,
and every route that changes a song answers the song whole, which is what the page patches its
list from instead of fetching the songbook again. A songbook's texts and envelopes, multiplied by
every song, are what the list would otherwise carry on each edit.

An id is a random 15-character string. Rows imported from PocketBase keep their PocketBase ids,
which is what keeps the references between rows intact.

## The `Songs` rows and `sheets/` are what the migration reads

`Songs` rows and the `sheets/` folder (each sheet's bytes under its id, the `sheets` table naming
it) are no longer read or written by any route: they are what
`../scripts/migrateSongbook.ts` moves into the library, and they are left in place after it, a copy
nothing serves. A sheet is served from the song's library folder, fetched once into the local cache
(`ensureSheetFileCached`, `../src/store/songMedia.ts`).

## Backups

`k7.db` runs in WAL mode, so copying the file while the backend writes it can capture half a
transaction. Back it up with `sqlite3 k7.db "VACUUM INTO 'backup.db'"`, or stop k7 first. The
songbook is backed up with the library's volume.

## The one-time import from PocketBase

The server's rows used to live in PocketBase. At boot, when `POCKETBASE_URL`, `_EMAIL` and
`_PASSWORD` are set and none of PocketBase's rows is in the store yet, `../src/pocketbaseImport.ts`
copies every collection `schema.ts` names, plus every sheet with its bytes, keeping the ids. It
never writes to PocketBase.

- **"Already imported" is read off the ids, not off an empty store.** Any row written before the
  credentials were set (a session, a star) would otherwise close the import for good, leaving the
  songbook empty with no error. Kept ids make the test exact: one PocketBase id present means an
  earlier boot imported it, and the boot says so. Ids are random, so a row the store made itself
  does not collide with one from PocketBase.
- **A URL without its credentials is reported.** Compose always names `POCKETBASE_URL`; with no
  `_EMAIL` or `_PASSWORD`, the boot warns that nothing is imported instead of skipping silently.

- **Routes wait for it.** Every rehearsal route waits until the import is done, so nothing is
  written into a store that is only half filled. Only the rehearsal paths wait: k7's other `/api`
  routes share the process and never do.
- **All rows or none.** The sheets are written first, then every row in one transaction. A
  PocketBase that fails partway leaves none of its rows behind, the routes answer 503 saying why,
  and the next start tries again. A sheet written again on a retry replaces the earlier copy.
- **Only the fields `schema.ts` names.** PocketBase's own columns (`created`, `collectionId`…) and
  any field abandoned since are left behind.

Once k7 has logged `rehearsal: imported …`, the `pocketbase` service, its volume and the three
variables can be removed (`../../../docker/docker-compose.yml`).
