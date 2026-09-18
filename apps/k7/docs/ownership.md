# Who sees what

Everything k7 saves belongs to the person who saved it, and nobody else can see it: sessions and
their takes, moments and their clips, markers, releases and their versions, pages, the Supernote
settings. There is no sharing feature yet; when one exists, it is the only way past this rule.

Two things are shared instead: the **songbook**, and the **singing exercises**.

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
lyrics, tablature, sheets, the reference track. A song still records who created it, and only
that person can **delete** it: editing is how a shared book grows, while deleting one song would
wipe someone else's work at once. The page shows the delete button to the creator alone (`mine`
on the song), and the backend refuses anyone else with a 403.

The **singing exercises** follow the same shape for the same reason: a warm-up somebody wrote down
is worth having whoever is at the desk, so every logged-in user lists them, adds to them and
improves them, while an entry records its author so that only they can remove it. There is nothing private to keep here —
an exercise is a sentence about what to sing.

**A favourite is a person's**, not the song's: `SongFavorites` holds one row per user and song, so
one person's stars never reorder or mark anyone else's list. What follows the star is personal —
the songbook export takes the user's favourites ([export.md](export.md)) — while the Supernote
sync pushes the whole songbook, being the device's copy of the shared book
([supernote.md](supernote.md)).
