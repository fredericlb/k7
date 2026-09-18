# The Mix view reads a playlist

The song list comes from the **playlist the surface names** — a `playlist:` line in
`surfaces/<desk>.yaml` — and not from the whole médiathèque cache on the chosen machine. That is
what makes this view speak about the open project like every other one, and why the project tree
stays beside it.

## It is a PARAMETER of the surface

```yaml
# surfaces/desk.yaml
type: turntables
layout: split
playlist: ete-2026        # → <espace>/_playlists/ete-2026.yaml
mapping: { … }
```

A **name** and not a path, for the reason a module ref is one: the folder is fixed, so spelling
it in each declaration would give a file the right to be wrong about a location nobody chooses.
`playlistPathOf` does the conversion and refuses anything that would leave the folder.

And a parameter of the SURFACE, not of the project: the screen with a song browser is the one
that must say what it rummages in. A `timeline` carrying the same line would have it ignored —
so the schema refuses it instead, being `.strict()`: a field accepted and inert sends whoever
wrote it looking elsewhere.

## The cue points are not in the playlist

A playlist says **which** songs the set plays, and it is the right document for that: it has a
screen (st0's cog opens it) and it is shared between sets. What it has nowhere to put are *this*
set's **cue points**, eight per song. A cue belongs to the desk playing the song and not to a
list others read — two bands covering one title do not drop the needle in the same place, and a
playlist carrying one set's marks would hand them to the other. So the cues live in
**`mix.yaml`**, at the project root, under `cues:` ([cues.md](cues.md)).

## Two sources, and the playlist decides

| source | what it says |
|---|---|
| the playlist the surface names | **which** songs are to hand tonight |
| `/mediatek/list?family=songs` on the file service | which of them this machine can play |

`resolveItems` crosses the two — **the same function st0's playlist screen uses**
(`@studio/mediatek/playlistItems`), and that is the point: "path first, name second" is a rule,
and two copies would diverge the day one of them learnt a case.

Hence a line may name a **variant**: `SetEntry.file` carries the file the line asks for, master
or not. Reading `meta.master` directly could only ever play the original, so a set list saying
`instrumental` would put the wrong record in front of an audience.

## Three states when there is no list

| what is true | what the desk says |
|---|---|
| the surface names no playlist | "add a `playlist:` line in `surfaces/…`" |
| it names one that is not on disk | "the playlist this surface names cannot be found" |
| it names one that is empty | nothing: a set list being filled in |

Three sentences because the repairing gesture differs each time. An empty browser with no
explanation reads as an empty médiathèque, which sends you looking in the wrong place.

## Where the list is read

Not in the middle of the desk: a record is chosen **at the record itself** — a click at the
centre of a vinyl opens the picker ([songBrowser.md](songBrowser.md)), which is already the only
way to load a deck. A column repeating what the record knows would take the width the decks
want. The crossing, the three states and their sentences are that picker's, reading the same
`SetList`.

## A line that cannot play stays on screen

A song the playlist names and the cache lacks **stays in the list**, greyed, with its download
icon. That is an ordinary state: the sync pulls what the open project names (`mediatekPull`), so
a song added a minute ago is on its way. Dropping it would make a set missing three songs look
identical to a set that never had them, on the one screen where that difference matters most.

The reasons Play does not work are therefore said separately: not in the cache yet, catalogued
folder with no audio, a variant the folder has not got, no engine on this machine.

## A duplicate, though, is removed

A playlist may legitimately name the same song twice — st0's screen draws both rows, because
there it is a document being edited. Here it is a **browser**: two identical rows are two chances
to load the same record without knowing which one you got.

The variant is part of the identity: a song's master and its instrumental are two records, and
conflating them would throw one away.

## Dragging a line onto a deck

st0's **playlist panel** — the cog's, docked right — can stay open while a `turntables` surface
is on screen. Its rows are therefore `draggable`, and each deck is a **drop zone**, strip and
knobs included: aiming at the vinyl's label is a gesture for a settled mouse, not for a hand
crossing the screen.

**What travels is the LINE, not the resolved song.** `SongDrag` carries the two fields a playlist
line *is* — `song` and, when it names one, `variant` — and the desk resolves them against its own
set list, exactly as it resolved the others. Sending the already-resolved médiathèque entry would
let another half of the application decide what goes on the deck, with its own idea of the file
to play; the line can only lie about itself. It is also what keeps duplicate and variant meaning
here what they mean above: `entryKey` is the same identity on both sides.

The format is **our own MIME** (`application/x-studio-song`) rather than `text/plain`: a browser
will drop almost anything onto a page — a file, a URL, a piece of selected text — and a deck
accepting `text/plain` would load whatever the user last copied elsewhere. `parseSongDrag`
further refuses anything that is not the expected shape: the content of a transfer is written by
the page it came from.

**A song this surface does not know is refused by name.** The panel shows the playlist being
edited, which is not necessarily the one the surface names — a frequent case, not a programming
error. The drop says so in the view's error card rather than doing nothing, because a gesture
that fails silently reads as a bug in drag-and-drop.

## What plays, once the line is chosen

The project's **compiled** document, into which `withDecks` places both decks' clips — so the
set's real chains, crossfade included. A `jsdsp` module is a graph baked into the document by the
compiler, which runs the module's source in a child process: the browser cannot produce one, and
`deckDoc` is only a stand-in of one track per deck until the compile arrives. See
[mix.md](mix.md) and
[packages/song/docs/setProject.md](../../song/docs/setProject.md).
