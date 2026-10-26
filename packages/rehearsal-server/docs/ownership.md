# Who sees what

Everything the rehearsal pages save belongs to the person who saved it, and nobody else can see it: sessions and
their takes, moments and their clips, markers, releases and their versions, pages. **A page's
nametag is the one way past this rule**, graded by the page's own visibility: public, anyone signed
in, or its owner alone ([pages.md](pages.md)). The releases it lists are heard through it, and
only through it.

Two things are shared instead: the **songbook**, all of it, and the **singing exercises**.

## Owned: filtered by list, guarded by address

Every row carries the `OwnerId` of the user who created it (`sub` from the session). A list is
filtered on it, and every route that names an item by id — `/api/sessions/:id`,
`/api/releases/:rid`, `/api/pages/:pid` — runs `ownerGuard` first, which answers **404** rather
than 403: a stranger learns nothing, not even that the id exists.

A route that names a child inside a guarded parent — a moment or a marker of a session, a version
of a release — must look the child up **within that parent** before reading, writing or deleting
it. The guard only proved the parent is yours; row ids count up across everyone's rows, so a
child found by its id alone is anyone's. The same goes for caches: a clip on disk is named by its
row id and has no owner of its own, so the database is asked before the cached file is served.

## Shared: the songbook and the practice book

Songs are the band's common book, so every logged-in user lists, reads and **edits** every song —
lyrics, tablature, sheets, the reference track. Only an **admin** can **delete** one: editing
is how a shared book grows, while deleting a song wipes everyone's work on it at once, its creator's
included, so it belongs to whoever looks after the book rather than to whoever added the song. An
admin is a member of one of the OIDC groups in `AUTH_ADMIN_GROUPS` — read from k7's backend
section, the same variable and the same `groups` claim that make an admin of k7's libraries; left
empty, no song can be deleted.

There are no private songs. A song is a folder of the shared library
(`../../mediatek/docs/songbook.md`), which every account reads, and a song hidden from some of them
would be a rule the library could not keep.

Delete is an entry of the song's ⋮ menu, drawn only when the song says `canDelete`. The backend
works that flag out per request and refuses a delete without it with a 403.

A song a device copied from its server (`songbookCopy.md`) is the exception to both rules. It is
read-only on that device, and anyone using the device may remove it, because removing it there
takes nothing off the server.

The **singing exercises** follow the same shape for the same reason: a warm-up somebody wrote down
is worth having whoever is at the desk, so every logged-in user lists them, adds to them and
improves them, while an entry records its author so that only they can remove it. There is nothing private to keep here —
an exercise is a sentence about what to sing.

**A favourite is a person's**, not the song's: `SongFavorites` holds one row per user and song, so
one person's stars never reorder or mark anyone else's list. What follows the star is personal —
the songbook export takes the user's favourites (`packages/ui-rehearsal/docs/export.md`).
