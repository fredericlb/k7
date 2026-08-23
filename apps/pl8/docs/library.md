# The catalogue screen: the tree, and what a row means

`apps/pl8/frontend/src/Library.tsx` is the médiathèque: the sections as header tabs, the current
one's files as a tree down the side, its contents in the middle. This page holds the reasoning
the file used to carry in prose, so the code can point at it in one line.

The address side of the same screen is [routing.md](routing.md); the narrow-screen side is
[responsive.md](responsive.md).

## A family, a zone, and two sections with nothing on the volume

`SECTION_IDS` holds more than the families. `FamilyId` is derived by SUBTRACTION — everything
that is not the capture zone, the engine page or the hunt page — so a new family costs one entry
and nothing else. The price is that a section which is NOT a family has to be named in that
`Exclude`, or it silently becomes a family the poll asks the server to list.

One poll drives the lot: fetch the revision map, reload the SELECTED section only when ITS token
moved. A section nobody is looking at just updates its count on switch. The capture zone is in
that map beside the families, so there is exactly one poll for everything the volume holds. The
engine page and the hunt page are skipped outright — nothing they show is on the volume.

Changing section drops what was held AND the token claiming it was current. `entries` holds one
section at a time, so on switching, the new section's revision token lies: it says nothing moved,
which is true of the VOLUME and false of the screen, which now holds nothing. The poll then did
not reload and the spinner span forever. It hangs off `section` rather than off the tab's click,
because Back and a deep link change section without going through it.

> The repositories had a SECOND poll here, on `/api/projects` and `/api/shares`, running on every
> section because the tab's badge had to hold a number at all times. Both are st0's home page now
> (`apps/st0/frontend/docs/projects.md`), so this screen is back to one poll for one volume. The
> routes are untouched and still this service's; only the caller moved.

## What a tree row stands for

The tree is derived, never stored: it IS the entry list in another shape, so a second copy could
only ever disagree with it. Sorted alphabetically all the way down, whichever builder made the
rows — a listing arrives in the order the scan walked it, which is an order nobody can look
something up in.

`treeOf` builds it from the entry PATHS alone: the service hands out a flat list and the shape is
already in the strings. Directories are synthesised on the way down, so a folder holding only
folders still appears. What no entry can stand for — an empty folder, a loose file — arrives as
its own `unlisted` list and is walked in FIRST, so an entry landing later finds its folder already
there. Without it, creating a folder answered 200 and showed nothing, which is the one thing a
"create" must never do.

A **song** is the odd row: a folder on disk, a leaf in the tree, and the only row of that family a
menu may act on. Everything above it is an artist or an album — a segment the scan deduced from
tags rather than a thing anyone made. It does not fold like the other leaves, because it holds its
variants and because a file dropped on it becomes one: the shared tree only makes FOLDERS into
drop targets. A folder with no `song.yaml` is `catalogued: false`, which is a song nobody filed,
not a category.

A song's children are the versions its sidecar declares, named by that sidecar and NOT by a file —
half of them are not files, so the name is the one thing every variant has and the only one unique
within a song. That makes a variant path an identity rather than an address, the way the
synthesised root's empty path is; nothing addresses it as a file. `variantAt` reads one back by
cutting at the last slash and asking the listing whether what is left is a song, which nothing else
in the tree can look like.

The capture zone gets its own builder, `dayNodes`, and not `treeOf`: `treeOf` reads
`MediatekEntry.path` and there are no entries here to read. Its paths are zone-relative, mirroring
how a family's rows drop their family segment, so the root row the tree synthesises names the zone
exactly once.

The root row itself is synthesised in the component, as a real node. `rootLabel` looks like it
would do this and does not — the shared component uses it only to name the target of the background
context menu, never to draw a row. Wrapping the nodes is the only way to get a visible root, and it
gives the zone somewhere to drop onto while the family is still empty.

## Where the expansion comes from

`revealed` is STICKY, and that is the point: the shared tree re-seeds its whole expansion whenever
`reveal` CHANGES, so letting it fall back to null on closing the editor would collapse the tree the
person had just been browsing. It only ever moves to a new target, and an effect carries it across
the gap where a deep link names a file before the listing has come back.

It starts on `TOP_LEVEL`, which is a single NUL byte. `reveal` opens a target's ANCESTORS, and the
synthesised root's empty path is the ancestor of every path there is — so any target at all unfolds
the top level. NUL is the one byte no path can hold, so this value names no row: the top level is
all it unfolds, and everything below stays folded until something is actually revealed.

## Who may write, and where a drop lands

Two sections refuse the tree's writes, for two different reasons. `songs/` has a shape deduced from
tags, so a folder made by hand there is not a badly filed song but an invisible one
(`packages/mediatek/docs/songs.md`). A capture is named by the clock, so a renamed one would be a
capture at an hour it was not made (`packages/mediatek/docs/recordings.md`). Both have a header
button instead.

`songs/` still gets a menu, and only its own: add a version, queue the morceau, remove it. None of
those touches the deduced shape — one writes INSIDE a song that already exists, the other takes a
whole one away — and each `when` accepts a row only when the listing calls it a song, so the artist
and the album above it are offered neither. A variant of an album is not a thing, and one click
there would delete every morceau underneath. The shared tree opens no menu at all when nothing
passes, which is how those rows keep the browser's own, and how the capture zone gets no menu
either.

That same early return is why every target needs at least one action whose `when` passes: an empty
menu does not open, it simply never appears. Folders and the root would otherwise have none.

Deleting a song goes through the TREE route, not the single-file one: a song is a folder on disk
though a leaf in the tree, so `remove` would leave the folder — and with it a song the scan still
finds.

Drops are `onDropTree` rather than `onDropFiles` because a folder has to arrive AS a folder, which
`dataTransfer.files` cannot carry. In `songs/` a drop is a variant and only onto the morceau
itself; the rows above it are an artist and an album, which hold nothing. The shared tree decides
whether a row is a target from the prop alone and has no per-row test, so those rows do highlight —
hence the message saying why nothing landed, rather than a swallowed drop.

Every write has a PICKER beside the drag, for one reason: a drag-and-drop that fails does so
silently, which is a bad only-way-in. The folder picker needs its own hidden input because
`webkitdirectory` is the input's property rather than the click's, and it resolves its target
through the same mapping the drop uses — the two must not disagree about where the same folder
lands. The variant picker is a second input, because that one names a directory and a variant is
one audio file. Both reset `value` before opening, or picking the same thing twice fires no
`change`.

## Filing variants

Audio dropped on a song's row is uploaded ONE REQUEST AT A TIME, because each one writes a line in
the sidecar and the second must read the first's: sending them at once would have two writers
deciding independently that `instrumental` was free. Refusals are collected rather than thrown, so
a folder holding one PDF still files its four takes. `refresh()` runs before the errors are shown,
since it clears the message and what it clears must be the old one.

The waveform, the onsets and the tempo are then asked of the machine that has an engine — a file
variant is a file in the library and nothing about it is special
(`packages/mediatek/docs/variants.md`). Never awaited, and best effort: the version is filed either
way.

After a write of our own, `refresh` FORGETS the section's revision rather than waiting for the
server's token to move. Waiting would leave the tree stale for a beat, and the person who just
dropped a file is looking straight at it.

## What left this screen

- **The `modules` and `chains` families.** A module is what a plugin is, and only a LOADED plugin
  can say what its parameters are called; the médiathèque has no project to load one into. The
  builder, the read-only module view, the chain editor, the engine gate over the Modules section
  and the third column that showed a picked module all went with them. Modules are authored in st0.
- **The pass that generated a module's `ui.yaml`** from a plugin's parameter list. A generated
  panel can only ever be knobs and dropdowns — `fader`, `meter`, `filepicker`, a rowSpan, an
  arrangement that means something are all things a person puts there and a parameter list cannot
  imply. Run over a library it turned a mixer's channel strip into five knobs in a row.
- **"Ajouter les N greffons du moteur"** and "Nouveau module depuis un greffon…", which turned a
  machine's plugin scan into library modules. The capability belongs in st0 and is not ported yet.
- **A song's variants as a fourth column**, shown only while nothing was open. Clicking a song now
  OPENS it, so that condition could never be met again; they moved under the player in
  `apps/pl8/frontend/src/SongEditor.tsx`, where they belonged anyway — the master and its
  alternative versions are the same question.
