# Why PocketBase, and what that costs

k7's rows — sessions, moments, markers, releases, versions, pages, singing exercises, songs,
favourites, Supernote sync — and its song-sheet attachments live in a PocketBase instance k7
alone talks to. Nothing else in the studio reads it; unlike the médiathèque, this store has one
consumer.

PocketBase was picked over a file-store-only option (MinIO, S3) because the data here is mostly
**rows**, not bytes: ten collections of typed fields, queried and joined in app code, with a
handful of small PDF/image attachments riding along on one of them (`Songs`). A blob store alone
would have left the rows nowhere to live; PocketBase is a database with attachments as a field
type, which is the shape this app actually needs.

## Ids are opaque strings, not integers

`store.ts` compares a route's `:annId` / `:markerId` / `:momentId` against a row's own id as
plain strings — no `Number()` cast anywhere. A PocketBase id is a random 15-character string, not
an auto-incrementing integer: there is no meaningful ordering to lean on, and comparing by value
is all the code ever needed even when ids used to be numbers.

## Attachments are their own collection, not a field type

Grist's attachment column doesn't exist here. A song's sheets are rows in `song_sheets` — one per
file, with a `song` relation (cascade-deleting them when the song goes) and the actual `file`
field. `Songs.SheetMeta` still carries the ordered `{id, name, mime}` list every reader already
expects; `id` is now that `song_sheets` row's own id, which is also what `downloadAttachment`
takes.

`Songs.SheetFiles` — Grist's own attachment-list column, read only by Grist's UI — has no
PocketBase equivalent and is gone. Nothing in k7 reads it.

## The schema is reconciled at every boot

`backend/src/ensureSchema.ts` runs when the server starts, and `npm run migrate` runs the same
thing by hand. It is not left to a deploy step because PocketBase **silently drops** a write to a
field it does not have: a field added to `schema.ts` and never migrated answers 200 to every write
and reads back empty, with nothing in any log. A PocketBase that cannot be reached at boot is
logged, not fatal.

## What the reconcile will not do

It creates a missing collection and adds a missing field to one that already
exists. It never drops or retypes a field: an app version rolled back after a schema change keeps
reading what it always read, and a field two versions abandoned stays on disk until a human
decides to clear it.

## No credentials on the wire to end users

PocketBase collections here carry no access rules (`listRule`/`viewRule`/… all unset), which
makes every collection superuser-only. That is deliberate: k7's backend is PocketBase's one
client, authenticating as a superuser with `POCKETBASE_URL` / `_EMAIL` / `_PASSWORD`, and nothing
about PocketBase's own auth model — rules, tokens, realtime subscriptions — is exposed past it.
The ownership and sharing rules a request has to satisfy are still the ones `ownership.md`
describes; PocketBase enforces none of them itself.
