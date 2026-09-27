# The playlist file

The rationale behind `packages/song-schema/src/playlist.ts` — where a workspace keeps its playlists,
what one says, and how a line is added to one AS TEXT. What a playlist is FOR lives in
`packages/song/docs/playlists.md`; this page is the file's own rules.

## `_playlists/`, at the workspace root

Beside `_modules` and named like it, because it is the same KIND of thing:
something every project in the workspace draws on, found by where it sits rather than by a line
declaring it. A playlist is not a project and does not belong inside one — you build a set list once
and open it against whichever project you happen to be working in.

That is also why it is not in the médiathèque. A playlist is pure REFERENCE: it holds no bytes, only
names of things filed elsewhere, so hosting it buys nothing and costs the account a document it
cannot version with its work. `_playlists` is in the repository, so a set list is committed, branched
and cloned with the songs it was built for.

## A playlist IS its file

Unlike a song, a chain or a module, which are folders around one — so there is no `playlist.yaml`
marker to look for and the extension is the whole rule. That asymmetry is deliberate rather than an
oversight.

`playlistPathOf` turns a NAME into the workspace path (`ete-2026` → `_playlists/ete-2026.yaml`). The
name is what a surface writes (`surfaces/desk.yaml`'s `playlist:`), and it is a name rather than a
path for the reason a module ref is: the folder is fixed, so spelling it into every declaration would
let a file be wrong about a location nothing can choose. Subfolders are kept — `live/repet` is a
playlist filed under `live/` — because `_playlists/` nests. The extension is added when missing and
kept when there: it is what makes the file a playlist, and somebody who writes it out has not made a
mistake. It returns null for a name that would leave the folder, rather than throwing: this runs on a
value out of a YAML file somebody typed, and the surface that asked reports it beside the control it
breaks, which is a screen you can read, unlike a project that refuses to open.

## Reading one

`song` is kept VERBATIM: resolving it means holding the médiathèque listing, and this file
deliberately holds nothing (see `packages/song/docs/playlists.md`, "the refs are not checked here").

`parsePlaylist` returns null and not an empty playlist when the text is not one, because the two are
different facts and a surface says so differently: a file that does not parse is one to go and fix,
an empty `items:` is one to go and fill. It is the distinction `readSong` declines to make — a song
is still a song with an unreadable sidecar, because the AUDIO is the song — and a playlist has
nothing but its text.

An item may be a bare string, which is what anyone actually types for the common case, or a mapping
when it has to name a variant too. Anything else in the list is DROPPED rather than coerced: `- [x]`
is a malformed line, and inventing "[object Object]" as a ref would put a row on screen that points
at nothing anybody can go and look at.

`playlistStub` is what a file that does not exist yet says: a stub that PARSES, the way a module's
jsdsp stub compiles. The first thing the screen does with the text is draw the right-hand pane from
it, and an empty file would open on a parse failure for a playlist nobody has had a chance to get
wrong yet.

## Quoting

`yamlScalar` writes a string plain when it can and single-quoted when it cannot — not always quoted,
deliberately. This file is written by hand as much as by that function, the doc page shows bare
paths, and `- 'AC-DC/Back in Black/Hells Bells'` beside a line somebody typed without quotes reads as
two different conventions in one file. Song folders are `segment()`ed from tags, so they legitimately
carry spaces, `&` and parentheses — all fine unquoted in the middle of a plain scalar, none fine at
the start. The reserved words (`true`, `no`, `on`…) are quoted so a morceau called "No" stays a title
rather than becoming `false` under a 1.1 reader.

## Appending a line

`appendPlaylistItem` works on TEXT, never a re-serialisation. `yaml/edit.ts` takes the same care over
a project's files and for the same reason: these files carry comments and an order somebody chose,
and parsing to an object and dumping it back would quietly throw both away. Round-tripping a set list
through a serialiser is exactly the change nobody would notice until their notes were gone.

It returns null rather than a guess when `items:` is a flow sequence spread over several lines, or is
missing its key in a file that does not parse at all. The surface disables the button and says why;
inventing a second `items:` key lower down would produce a file whose two halves disagree, which is
worse than being told to type the line yourself.

The cases it does handle:

- **No `items:` at all** — a file with only a title, or one somebody started. The key goes on the
  end, which is where a reader looks for it and where it cannot land inside another block by
  accident.
- **`items: []`**, what the stub writes: the empty flow becomes a block, since that is the shape
  every line after it will be in.
- **A one-line flow sequence with something in it**: extended in its own notation rather than
  converted, which would rewrite a line nobody asked us to touch. A mapping inside a flow list is a
  shape too far, so an item with a variant declines.
- **A block below the key**: every line indented past it, blanks included. The last one that is not
  blank is what the new entry follows, so a trailing blank line stays trailing, and the indentation
  is taken from the file's own first entry rather than imposed.

A variant needs a mapping, whose second key aligns under the first — past the `- `, which is why it
is two more spaces and not the same indent.
