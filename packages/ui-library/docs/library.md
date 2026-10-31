# The catalogue screen: the tree, and what a row means

`src/MediaLibrary.tsx` is the médiathèque's catalogue: the current section's files as a tree down
the side, its contents in the middle — except the songs, which are a table across the page's column
(`src/SongsLibrary.tsx`, below). The sections themselves are the host's nav — k7's home
sidebar ([host.md](host.md)). It draws; the modules beside it hold the rest, one concern each — what
it shows of the volume and the poll that reloads it (`useLibraryData.ts`), the rows built from a
listing (`libraryTree.ts` for a tree, `songRows.ts` for the songs, pure and tested alone), the
right-click menus (`treeActions.ts`) and the middle pane (`LibraryContents.tsx`). This page holds
the reasoning, so the code can point at it in one line.

The address side of the same screen is [routing.md](routing.md); the narrow-screen side is
[responsive.md](responsive.md).

## One frame for every screen

Every section and every page opened from one sits in `LibraryPage.tsx`: the same column, and the
same header — the title, its count, the screen's own actions on the right, and on a detail page the
same **Back** at its left. Four sections that each draw their own top are four screens to learn.

- **The column is 64rem**, the width of k7's home pages (`apps/k7/frontend/src/projects/PageFrame.tsx`)
  and of the rehearsal pages, so a recording or a moment opened from **Recordings** keeps its title
  at the same x as the section it came from. A table wider than that holds no more information, only
  longer gaps between an artist and its album.
- **The title is the host nav's name for the section, the count is the nav's count.** The two come
  from the same labels and the same summary, so they cannot disagree.
- **A tool fills the height, a list scrolls as a page.** The samples' tree, the playlists and a
  song's tabs scroll their own panes under a header that stays; the songs' table and the captures'
  calendar scroll whole, header included.
- **The rehearsal pages draw the same Back** (`packages/ui-rehearsal/src/components/BackButton.tsx`):
  the arrow and the word, the same ghost button, the title at the same size. Neither package depends
  on the other, so the control is drawn twice to one design rather than shared.

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

A loaded section is marked with the token its LISTING carries, not the one the poll read. The
server may answer `/list` with the previous listing while it rescans a family that moved
(`packages/mediatek/docs/index.md`); that listing carries the older token, so the next poll still
sees a difference and reloads.

## The songs are a table, not a tree

The songs have no tree. Their folders are `artist/album/title`, deduced from the tags
(`packages/mediatek/docs/songs.md`), so a folder view only restated the tags one fold at a time, and
took a 290-pixel column from every song's page to do it. The section is a table across the page's
column (`SongTable.tsx`); opening a song puts its page in the table's place, in the same column, and
the page's **Back** returns to the table. Nothing sits beside either.

**Three groups, in this order: the practice list, the favorites, then every other song.** What a
person is working on this month comes first, then what they like, then the rest of the library. A
row goes in the FIRST list that covers it — a song, or a folder above it, being on that list — so a
practised favorite is listed once, under practice. Within a group, rows go by artist, then by title.

Each group is a BAND, tinted after the mark that put a row in it (`ListMarks.tsx`): practice on a deep
blue, favorites on a deep yellow, the rest on the background. The band, not a rule, is what divides the
table — the rows' separator is a hairline at a tenth of its strength, since a rule per row draws the eye
across five lines per song and the table then reads as one striped list.

**An album of several songs is one row**, which unfolds into its songs on a click. Without it, an
album starred whole would put a dozen rows at the head of the table and push everything else down.
An album of ONE song is that song's row, since a row that only unfolds into a single row is a click
for nothing. « Album inconnu », where a song without an album tag is filed, is not an album: those
songs are rows of their own. An album sits in the first group any of its songs belongs to, and
unfolds into all of them.

**Unfolded, an album is in its own order**: the track number first (`meta.track`), drawn as
`05 · Lithium`, then the songs without one by title. An album is listened to in that order, and an
alphabetical one scatters it.

The table's **⋮ on each row is the tree's menu**: the same `songActions` (`treeActions.ts`), drawn
by `RowMenu.tsx`, so adding a version, queueing, starring, practising and removing are offered the
same way they were. A removal asks first in a dialog. Audio dropped on a song's row files it as the
tree's drop did (Filing a dropped track, below). The paired server's songs are rows like the others,
muted, with their download in place of the menu. The unfolded albums are this screen's state, not
the address's: they are forgotten on leaving, like a tree's expansion.

**One search box at the table's head**, and it narrows rather than ranks: a row stays when every
word typed is found in its artist, album or title, case and accents folded by the same `normalize`
"Add a song" matches with (`packages/mediatek/src/songMatch.ts`). One box and not a field per column,
because a person remembers "that Nirvana one with the lithium" and not which column holds which word.
The groups keep their order, a group left empty disappears, and a search that keeps nothing says so.
An album named by its own title or artist stays whole; one kept only for some of its songs shows just
those, and while searching every album shows unfolded — the match is what was asked to be seen. The
query is held by `SongsLibrary`, above the song's page, so Back returns to the same narrowed table;
like the unfolding it is not in the address.

## What a tree row stands for

The tree is derived, never stored: it IS the entry list in another shape, so a second copy could
only ever disagree with it. Rows come in the listing's order, which the scan sorts by name.

**A tree is in the listing's order**, except inside a folder whose rows carry a track number, which
orders them (`byTrack`) — the songs' table draws an album in the same order, for the same reason.

`treeOf` builds it from the entry PATHS alone: the service hands out a flat list and the shape is
already in the strings. Directories are synthesised on the way down, so a folder holding only
folders still appears. What no entry can stand for — an empty folder, a loose file — arrives as
its own `unlisted` list and is walked in FIRST, so an entry landing later finds its folder already
there. Without it, creating a folder answers 200 and shows nothing, which is the one thing a
"create" must never do.

A song's **variants** are never drawn as tree rows — `SongVariants.tsx`, inside the editor the song
opens to, is where they show and where one is removed (`packages/mediatek/docs/variants.md`).

The capture zone has no tree: it is a calendar ([recordings.md](recordings.md)).

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

The tree unfolds its top level and nothing below it (`reveal` is always `TOP_LEVEL`): nothing in a
tree family opens a page of its own, so there is no open entry for it to open down to.

`TOP_LEVEL` is a single NUL byte. `reveal` opens a target's ANCESTORS, and the synthesised root's
empty path is the ancestor of every path there is — so any target unfolds the top level. NUL is the
one byte no path can hold, so this value names no row: the top level is all it unfolds.

## Who may write, and where a drop lands

Two sections refuse a tree's writes, for two different reasons. `songs/` has a shape deduced from
tags, so a folder made by hand there is not a badly filed song but an invisible one
(`packages/mediatek/docs/songs.md`) — which is also why it has no tree at all. A capture is named by
the clock, so a renamed one would be a capture at an hour it was not made
(`packages/mediatek/docs/recordings.md`). Each gets its button instead: **Add a song** in the songs'
page header, and **Add a capture** under the zone's calendar
([recordings.md](recordings.md)).

`songs/` gets a menu of its own, on each row's ⋮: add a version, queue the morceau, star it, practise
it, remove it. None of those touches the deduced shape — one writes INSIDE a song that already
exists, one takes a single song away — and each `when` accepts a row only for the kind of thing it
is.

**Deleting a song asks first**, yes/no, nothing typed — and every other delete in this screen does
not. The difference is what goes and that it cannot come back: a song's delete takes its whole
folder — master, variants, lyrics, chords, sheets — while a variant's takes one file. There is no
trash here, so a wrong click has no path back. The confirmation names the song by its listed title,
the folder's name only when it has none. The action carries it as a tree action's `confirm`, which
the table's `RowMenu` asks as a dialog.

**Every removal, and every folder rename or drag, is an admin's**, because the library is one
folder every account shares (`apps/k7/backend/docs/media/gate.md`). The service says so as `manage`
in its summary, and the menu entries and the folder drag are simply absent when it is false — an
entry that would only answer 403 is a promise the screen cannot keep.

That same early return is why every tree target needs at least one action whose `when` passes: an
empty menu does not open, it simply never appears. Folders and the root would otherwise have none.

Every menu here is reached WITHOUT a right-click: a tree is given `rowMenuLabel`, so each row with
actions carries a ⋮ button and answers a long-press (`commons/packages/ui/docs/file-tree.md`), and
the songs' table has only its ⋮. A phone has no right-click.

Deleting a song goes through the TREE route, not the single-file one: a song is a folder on disk, so
`remove` would leave the folder — and with it a song the scan still finds.

A tree's drops are `onDropTree` rather than `onDropFiles` because a folder has to arrive AS a folder,
which `dataTransfer.files` cannot carry. A song takes files, not folders: a drop on its row in the
table files the audio as its MASTER when it has none, as variants otherwise (see Filing a dropped
track below). Only a song of this machine is a target; an album row, holding no audio of its own, is
not.

Every write has a PICKER beside the drag, for one reason: a drag-and-drop that fails does so
silently, which is a bad only-way-in. The folder picker needs its own hidden input because
`webkitdirectory` is the input's property rather than the click's, and it resolves its target
through the same mapping the drop uses — the two must not disagree about where the same folder
lands. The variant picker is a second input, because that one names a directory and a variant is
one audio file. Both reset `value` before opening, or picking the same thing twice fires no
`change`.

## The server's entries are filed among these

On a machine paired with a server, the entries only the server holds are filed among those here —
in a family's tree (`treeOf`'s `remote`, `remoteRows`) under the same folders, and in the songs'
table in the same groups and albums (`songTable`'s `remote`) — rather than listed apart: a separate
flat list of a few hundred songs is not something anyone finds a song in. Such a row wears a cloud,
is muted, and a cloud button at its end brings it down. On a computer it does not open — there is
nothing here to open; on the phone it opens, read from the server ([songSource.md](songSource.md)).
A song held on both sides is one row, the local one. What a download takes, and why never a folder
whole, is `../../mediatek/docs/serverCopy.md`.

**An empty library here is not an empty section.** A phone starts with nothing of its own, not even
the volume: the "empty" and "nothing here yet" states are for a section with no entry on EITHER side,
so the server's songs fill the table as soon as the placement answers (`LibraryContents`).

**The song's glyph says where it is**, once the machine is paired: the three icons of the placement
(`PlacementIcon`) — synced, on this machine only, on the server only — in the slot where an unpaired
machine draws the disc. A song copied from the server must not look like one made here: the first
follows the server, the second is this machine's alone. A family's tree marks its synced entries the
same way.

## Favorites

A song or an album can be **starred** from its menu, and a starred row wears a star that unstars it
in one click. An artist cannot: an artist is a tag the scan deduced, and starring one would star
every album it will ever hold. A song is a favorite when it or any folder above it is starred, so an
album starred today still covers the song added to it tomorrow; the favorites are the table's second
group.

Favorites are the ACCOUNT's, not the volume's: the library is one folder every account shares, and
one person's favorites are nobody else's. They follow the account from one device to the next, so
they live on its SERVER (`apps/k7/backend/src/media/routes/favorites.ts`):

- **The page asks its own backend**, `/api/favorites`. A backend paired with a server (the tray,
  the phones) keeps no list: it asks the server's device door, `/api/sync/favorites`, with the
  pairing's token, which names the person. An unpaired backend, the server among them, answers
  from its own store. A server out of reach is an error on the star, not a local list that would
  drift from the others.
- **A store of their own, not the preferences file.** The page rewrites the preferences wholesale
  from the copy it read at load, so a list kept there would be put back as it was by any other
  setting changed in the same page. The preferences' old `favorites` field only seeds an account
  that has no list yet.
- **A click sends a state, not a toggle**: star or unstar these paths. Two devices clicking the
  same row agree on the result instead of undoing each other.
- **Stars made on a machine before it was paired go up once**, merged into the server's list, and
  the machine keeps none from then on.
- The page reads the list again whenever its tab comes back into view, which is when a star made
  on another device matters. No star is offered before the first read.

A star names a path, so a song moved or renamed loses it.

## Practice

The **practice list** is a second list of the same kind: a song or an album is added from its menu
(« Add to practice »), a practised row wears a mark that takes it off in one click, and it is the
table's FIRST group. Everything said of favorites above holds for it — the account's, kept on its
server, a state per click, a path covering what is below it — through its own route,
`/api/practice` (`apps/k7/backend/docs/media/practice.md`).

It is a list apart rather than a kind of star because the two answer different questions: what a
person likes to hear, and what they are working on this month. A song moves on and off the second
far more often than the first, and taking it off must not lose the star.

The two lists ORDER the table rather than filter it: every song is in it, so nothing is a click
away, and what a person is working on and what they like are at its head.

## Adding a song

**Add a song** is the one way a song enters the library, and it works as adding one to the songbook
does (`src/AddSong.tsx`): a popin asks its **artist and title**, then where its audio comes from.

- **Upload a file** — one audio file, filed under the names typed (`POST /api/mediatek/song`, the
  album left unknown). A song that already has its audio there is said, with a **Replace**.
- **Download it automatically** — the Soulseek hunt, given the names as tags so it files the song
  under them ([hunt.md](hunt.md)).
- **No audio** — only the song's folder and its names (`POST /api/mediatek/songbook`), the way the
  songbook makes a song before it has any: the catalogue lists it without a master, and a later
  upload or download of the same names fills that folder.

The NAMES come first and decide the folder, whichever way the audio comes, so the three land in the
same place. It adds one song at a time: a batch would be a different screen, deciding per song.
Once added, the song's page opens — its address at once, its screen as soon as the listing has it —
since what comes next for a new song is its chords, tab or sheet ([songPlayer.md](songPlayer.md)).

## Filing a dropped track

A song made without audio — the songbook's, or Add a song with no file — has no master, and a
version of nothing is not a version. So the first audio file dropped on it becomes its master, and
only the rest become variants (`../src/songMaster.ts`). It lands through the songbook's own write,
`POST /api/mediatek/songbook/:id/master`, rather than an upload by tags: that one tags the master
with the names the sidecar held, drops them from the sidecar, and queues the lyrics lookup — the
same song, the same folder, whichever screen gave it its track. The write names the song by its
uuid, so a masterless folder that has none (one made by hand) is adopted first,
which writes one. The variant picker in the menu stays a variant picker: it says so in its label.

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
- **No pass that GENERATES a module's `ui.k7x`** from a plugin's parameter list, anywhere. A
  generated panel can only ever be knobs and dropdowns — `fader`, `meter`, `filepicker`, a rowSpan,
  an arrangement that means something are all things a person puts there and a parameter list
  cannot imply. Run over a library, such a pass turns a mixer's channel strip into five knobs in a
  row.
- **No fourth column for a song's variants.** A column shown only while nothing is open could never
  be reached, since clicking a song OPENS it; the variants are under the player in
  `src/SongEditor.tsx`, where they belong anyway — the master and its
  alternative versions are the same question.
