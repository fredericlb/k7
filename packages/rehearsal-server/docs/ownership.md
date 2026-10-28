# Who sees what

Everything the rehearsal pages save belongs to the person who saved it, and nobody else can see it: sessions and
their takes, moments and their clips, markers, releases and their versions, pages. **A page's
nametag is the one way past this rule**, graded by the page's own visibility: public, anyone signed
in, or its owner alone ([pages.md](pages.md)). The releases it lists are heard through it, and
only through it.

One thing is shared instead: the **singing exercises**.

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

## Shared: the practice book

A warm-up somebody wrote down is worth having whoever is at the desk, so every logged-in user lists
the **singing exercises**, adds to them and improves them, while an entry records its author so that
only they can remove it. There is nothing private to keep here — an exercise is a sentence about
what to sing.
