# The catalogue screen: the tree, and what a row means

`src/MediaLibrary.tsx` is the médiathèque's catalogue: the current section's files as a tree down
the side, its contents in the middle. The sections themselves are the host's nav — k7's home
sidebar ([host.md](host.md)). It draws; four modules beside it
hold the rest, one concern each — what it shows of the volume and the poll that reloads it
(`useLibraryData.ts`), the rows built from a listing (`libraryTree.ts`, pure and tested alone), the
right-click menus (`treeActions.ts`) and the middle pane (`LibraryContents.tsx`). This page holds
the reasoning, so the code can point at it in one line.

The address side of the same screen is [routing.md](routing.md); the narrow-screen side is
[responsive.md](responsive.md).

## Two families, two zones, and a section with nothing on the volume

`SECTION_IDS` holds more than the families. `FamilyId` is derived by SUBTRACTION — everything
that is not one of the two root zones (recordings, playlists) or the hunt page — so a new family costs one entry
and nothing else. The price is that a section which is NOT a family has to be named in that
`Exclude`, or it silently becomes a family the poll asks the server to list.

One poll drives the lot: fetch the revision map, reload the SELECTED section only when ITS token
moved. A section nobody is looking at just updates its count on switch. The capture zone is in
that map beside the families, so there is exactly one poll for everything the volume holds. The
hunt page is skipped outright — nothing it shows is on the volume.

Changing section drops what was held AND the token claiming it was current. `entries` holds one
section at a time, so on switching, the new section's revision token lies: it says nothing moved,
which is true of the VOLUME and false of the screen, which now holds nothing. Without that drop
the poll does not reload and the spinner spins forever. It hangs off `section` rather than off the
nav's click, because Back and a deep link change section without going through it.

## What a tree row stands for

The tree is derived, never stored: it IS the entry list in another shape, so a second copy could
only ever disagree with it. Sorted alphabetically all the way down, whichever builder made the
rows — a listing arrives in the order the scan walked it, which is an order nobody can look
something up in.

`treeOf` builds it from the entry PATHS alone: the service hands out a flat list and the shape is
already in the strings. Directories are synthesised on the way down, so a folder holding only
folders still appears. What no entry can stand for — an empty folder, a loose file — arrives as
its own `unlisted` list and is walked in FIRST, so an entry landing later finds its folder already
there. Without it, creating a folder answers 200 and shows nothing, which is the one thing a
"create" must never do.

A **song** is the odd row: a folder on disk, but a `dir: true` node with an ALWAYS-EMPTY
`children: []` — folder-shaped only so the shared tree makes it a drop target (a file dropped on
it becomes a variant), never so it folds open. Everything above it is an artist or an album — a
segment the scan deduced from tags rather than a thing anyone made. `opensOnName` marks it as a
row that opens rather than folds, and the shared tree drops the chevron entirely for an opens row
with nothing under it (`commons/packages/ui/docs/file-tree.md`): one target, the whole row, onto
the editor. A folder with no `song.yaml` is `catalogued: false`, which is a song nobody filed, not
a category.

A song's **variants** are never drawn as tree rows — `SongVariants.tsx`, inside the editor the song
opens to, is where they show and where one is removed (`packages/mediatek/docs/variants.md`).

The capture zone gets its own builder, `dayNodes`, and not `treeOf`: `treeOf` reads
`MediatekEntry.path` and there are no entries here to read. Its paths are zone-relative, mirroring
how a family's rows drop their family segment, so the root row the tree synthesises names the zone
exactly once.

The root row itself is synthesised in the component, as a real node — but never DRAWN. `rootLabel`
looks like it would draw it and does not: the shared component uses that prop only to name the
target of the background context menu. Wrapping the nodes in one synthetic root and turning on
`collapseSingleRoot` is what keeps that row from ever appearing at all: the component skips a lone
top-level node's own row and draws its children one depth shallower instead, so what shows is the
family's real artists straight away, with no label row above them to fold or not fold. Wrapping is
still what GUARANTEES there is exactly one top-level node to collapse, whatever the family actually
holds — a library with a single real top-level artist would otherwise lose that artist's own row
the same way.

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
capture at an hour it was not made (`packages/mediatek/docs/recordings.md`). Both get their button
in the same place instead — a footer under the tree rather than a bar or the tree's last row:
the `aside` is a flex column with the tree in a scrolling pane above and the buttons in a fixed one
below, so scrolling a long library or a long capture history never carries them off screen.

`songs/` still gets a menu, and only its own: add a version, queue the morceau, remove it, and —
on the artist or album folder above a song — remove that whole grouping. None of those touches the
deduced shape — one writes INSIDE a song that already exists, one takes a single song away, one
takes a whole grouping away — and each `when` accepts a row only for the kind of thing it is. The
shared tree opens no menu at all when nothing passes, which is how the capture zone gets no menu
at all.

**Deleting an artist or an album asks first**, the tree's `confirm` gate — yes/no, nothing typed —
and every other delete in this screen does not. The difference is blast radius: a song's own
delete takes one song, a variant's takes one file, but an artist or an album can hold many songs —
and there is no trash here, so a wrong click has no path back. `confirm` rather than `prompt`
because there is no name to echo back as the answer: the row IS the thing being confirmed, not a
value to type again.

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

## Adding songs

**Add a song** takes one audio file or several (`src/AddSong.tsx`). Each file's tags are read in the
browser and its folder — artist, album, title — is shown BEFORE anything is sent, since that tree and
not the file's name is what files it; every field stays editable, per song.

Several are sent **one after another**, never at once: each is a whole audio file, and a dozen
uploads in parallel would share the line and finish together late, rather than one at a time early.
A song that went leaves the list. One whose folder is already taken stays, with a **Replace** of its
own — replacing is a decision made per song, never for a batch — and one that failed stays with its
reason, sent again with the rest. Editing a song's fields drops a pending Replace, because it now aims
at another folder. Cancel cuts the upload in flight and stops the queue; what was sent is filed.

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

## What this screen does not hold

- **No `modules` or `chains` family.** A module is what a plugin is, and only a LOADED plugin can
  say what its parameters are called; the médiathèque has no project to load one into. Modules and
  chains are authored in k7, against a project where the plugin is really there.
- **No pass that GENERATES a module's `ui.yaml`** from a plugin's parameter list, anywhere. A
  generated panel can only ever be knobs and dropdowns — `fader`, `meter`, `filepicker`, a rowSpan,
  an arrangement that means something are all things a person puts there and a parameter list
  cannot imply. Run over a library, such a pass turns a mixer's channel strip into five knobs in a
  row.
- **No fourth column for a song's variants.** A column shown only while nothing is open could never
  be reached, since clicking a song OPENS it; the variants are under the player in
  `src/SongEditor.tsx`, where they belong anyway — the master and its
  alternative versions are the same question.
