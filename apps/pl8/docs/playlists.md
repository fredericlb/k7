# Playlists — a section of the médiathèque

Where the files live and what the volume does with them is
[packages/mediatek/docs/playlists.md](../../../packages/mediatek/docs/playlists.md); the format
itself is [packages/song-schema/docs/playlistFile.md](../../../packages/song-schema/docs/playlistFile.md).
This page is the screen.

```
Morceaux │ Samples │ Enregistrements │ Playlists 3
┌────────────────┬──────────────────────────────────────────┐
│ été 2026    12 │ été 2026            playlists/…   ⟨/⟩ ✓  │
│ ▾ live         │ ── Chercher un morceau ── Tout écouter ── │
│   répét      8 │ 1 ▶ Hells Bells          AC-DC   ↑ ↓ ×   │
│ ⚠ cassée     0 │ 2 ▶ Lithium · instru     Nirvana ↑ ↓ ×   │
│ + Nouvelle     │                                          │
└────────────────┴──────────────────────────────────────────┘
                                        ⟨/⟩ ─▸ the YAML, beside
```

## A section, beside the families

It is a **tab** and not a corner of another screen, because a set list is what you come here for on
the evening you build one. Two columns: the volume's playlists on the left, the open one on the
right — the same shape the rest of the app uses.

The left column is the same `FileTree` the families draw theirs with, not a bespoke list: a
playlist NESTS — `live/répét` is one, filed a folder deep — so the left column is a folder walk
after all, the same as everywhere else on this volume a path can hold a `/`. `playlistTree` turns
the zone's flat listing into the tree the component wants, exactly as `treeOf` does for a family;
a row's icon and its count come from `summaryAt`, which answers null for a folder grouping and the
matching line's own summary for a playlist. A file that does not parse is drawn all the same, with
a warning triangle in place of the note glyph, since hiding it would hide the one thing you came to
repair. Nothing here carries a right-click menu: renaming or filing one into a folder is a name
typed at creation, not a tree write, and deleting one is not yet a thing this screen does.

## The buffer is the document

Every button in the right-hand pane — ↑, ↓, ×, and adding by search — edits the **text** and hands it
back. Nothing writes the file directly. That is the whole discipline of this screen: the YAML pane
and the row list are two views of one string, so opening the text half never shows a version that
disagrees with the rows above it.

It also means the graphical edits go through the same three functions the format defines —
`appendPlaylistItem`, `removePlaylistItem`, `movePlaylistItem` — which work on the text and never
re-serialise. These files carry comments and an order somebody chose, and round-tripping a set list
through a dumper is exactly the change nobody notices until their notes are gone.

A shape those functions cannot take — an inline `items: [a, b]` — **disables the three buttons with
the reason in a tooltip**, rather than reformatting somebody's file.

## No Save button

The file is written as soon as the buffer **reads as a playlist**, on the shared autosave
([packages/ui-editor/docs/autosave.md](../../../packages/ui-editor/docs/autosave.md)). A half-typed
line anywhere holds the whole write back — the file is written whole or not at all.

The validator is this screen's own: `validateFile` routes on a project's file names and knows
nothing of this folder, so it would call any YAML here `ok` and let a half-typed line reach disk.

The rows follow **keystrokes rather than saves**, and are only replaced by something that parses:
half-typed YAML fails about every other keystroke — a bracket not yet closed — and a list that
emptied each time would flicker for the length of the line being written. A banner says when what is
shown is behind the text.

## The two catalogues meet here

`parsePlaylist` keeps its references verbatim, so a line means nothing until it is held against the
songs. This screen loads that listing **itself**: the section has no family behind it, so the shell
holds no entries for it, and a line resolves against `songs` whichever tab you arrived from.

A line resolving to nothing **stays on screen**. The file is edited by hand, one click away — a row
that vanished silently would be a typo you cannot see, and a row saying "morceau introuvable" is one
you fix. The sentences are `itemProblem`'s, shared with st0.

## Playing, and the queue

Two different gestures, and the difference is the one this app already draws
([miniPlayer.md](miniPlayer.md)):

| | what it does | why |
|---|---|---|
| ▶ on a row | starts **that line**, the version it names | a variant is chosen one at a time, and `NowPlaying` carries one |
| « Tout écouter » | puts the songs in the **queue** | the queue is what you are listening to now; it carries entries, so masters |

So a line naming a variant plays that variant from its own button, and enters the queue as the
master. The queue is deliberately not taught about variants: it is the tab's "what next", filled from
a right-click anywhere in the app, and one shape of item is what keeps it arbitration-free.

The screen holds **no transport of its own** — it calls `usePlayback()`, being inside the provider.
Two things claiming the word "playing" on one screen are two transports, and this app already has
the one at the bottom.

## Adding a song

"Chercher un morceau" opens a field **above** the list, not over it: what you are filling stays
visible, and watching it grow is the only confirmation there is. Every word must land somewhere,
not in the same place, so "nirvana lithium" finds a song where one is the artist and the other the
title. Enter takes the first hit, Escape closes, and the field **stays open** after a click —
building a set list means adding eight songs in a row.

A row adds the **master**; the pills beside it add a **variant**, without which putting
`instrumental` in a set list would mean hand-editing the mapping the format exists to carry.

The songs are already here — this is the médiathèque — so there is no link away to file one first.
That is the one thing this screen has that st0's does not.

## The same format as a workspace's

A playlist here is byte-for-byte a playlist under a workspace's `_playlists/`: one schema, one
parser, one set of text edits, in `@studio/song-schema/playlist`. A file copied either way is read by
both.

What differs is **where it is filed and what that costs**:

| | here | a workspace's `_playlists/` |
|---|---|---|
| lives on | this volume, beside the songs it names | the git repository the songs were played for |
| versioned | no — the volume is not a repository | with the project, branch and clone included |
| reachable | any browser with the session | the machine whose file service is up |
| names a surface's `playlist:` | no | yes — `surfaces/desk.yaml` resolves against the workspace |

The consequence worth knowing before you build one: a set list a **`turntables` surface** names is
resolved in the workspace, so a DJ desk's browser and the pre-fetch that fills the machine's disk
read `_playlists/`, not this folder ([../../../packages/st0-plugins/docs/turntables/setList.md](../../../packages/st0-plugins/docs/turntables/setList.md)).
A set list built here is one you read, sort and listen to on this volume.
