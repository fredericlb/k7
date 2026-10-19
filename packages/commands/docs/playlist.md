# The `playlist …` verbs — a workspace's set lists

`_playlists/` sits at the workspace root, beside `_modules`, so these verbs act on `repoDir` and
never on `songPath`: a playlist belongs to the workspace and stays the same whatever project is
open. They are the only verbs in the catalogue that work **without a project** — except
`playlist stems`, which needs one to resolve its chain and says so.

Where a playlist lives and what shape it has is `packages/song/docs/playlists.md`; what the screen
does with one is `apps/k7/frontend/docs/playlists.md`.

## Where a name lands — `playlistFile`

Both writing verbs go through it, so "where does `live/repet` live" is answered once. Two things
have to be true and each is refused by name: there is a **workspace** to hold it, and the name stays
**inside** `_playlists/`.

The verbs act on `repoDir` and never fall back to `songPath`. `_playlists/`
at a project root would be a second, invisible set of set lists — one per song, which is exactly the
shape they exist to avoid.

The containment check is not `playlistPathOf`'s job done twice. It rejects a `..` **segment**,
splitting on `/`, which is the whole of the rule on a machine whose separator is `/` and half of it
on Windows, where `..\..\x` is one segment to that function and three to `join`. The file service's
`safePath` says the same thing for every path a browser sends; this is the same sentence for a path
a command line supplies.

## `playlist new <name>`

An existing file is **refused, not opened**. A "create" that quietly hands back somebody else's set
list is how you edit the wrong one.

It writes the **stub** rather than an empty file. The screen draws its right-hand pane from the
text, so an empty one would open on a parse failure for a playlist nobody has got wrong yet.

## `playlist song add <playlist> <song> [variant]`

The song is the **rest of the line**, spaces included, because a song's ref is a path through the
médiathèque's folders (`AC-DC/Back in Black/Hells Bells`), and asking for quotes around the common
case would be asking for them every time. QUOTE it and a variant may follow — one rule, and the only
one that can tell "a song with spaces" from "a song and a version".

The ref is kept **verbatim and nothing checks it**. The catalogue is another service's, and a
playlist that refused a song you are about to upload would be a playlist you cannot write ahead of a
gig. The screen says "morceau introuvable" against the same line, which is where the two listings
meet.

`appendPlaylistItem` answering `null` is the FILE's shape refusing the append — a flow `items: [`
spread over lines, say. That refusal is the same one the screen's button wears, and for the same
reason: inventing a second `items:` key lower down would write a file whose two halves disagree.

## `playlist song remove <playlist> <n>` and `playlist song move <playlist> <from> <to>`

The other two thirds of editing a set list. Until these existed, `PlaylistPane` could append and
nothing else, so **taking a song out or changing the running order meant opening the file** — on the
one screen whose whole job is the order of an evening, and usually shortly before one.

**They count from 1, and they address a line by POSITION rather than by song.** A set list may name
the same song twice — an encore, a segue played again — and there is no defensible way to choose
between the two, so it does not try. The position is what the screen prints beside each line, which
is what makes the number on the command line and the number under your finger the same number.

Both are TEXT edits over `playlistItemLines`, which answers the line span of each entry, so a
`variant:` travels with the song it belongs to and a comment somebody wrote under a line moves with
that line. Two prices, both real:

- **A flow `items: [a, b]` is refused rather than reflowed.** Appending knows that notation and
  extends it in place; reordering inside it would mean re-emitting the list, which is the
  re-serialisation this whole family exists to avoid. The stub grows into a block on its first
  `add`, so the shape only shows up in a hand-written file.
- **Blank lines BETWEEN entries do not survive a move.** The reorder rewrites the span from the
  first entry to the last, and a blank inside it has no entry to belong to. Comments do survive,
  because they attach to the entry above them.

Removing the last line rewrites the key to `items: []`. A bare `items:` reads back as null rather
than as the empty list the file means, and the next `add` would then be extending a shape that is
not there.

## `playlist stems <playlist> [chain]`

Separate every song of a set list, before the evening. This is the preparation half of cutting a
stem live: a deck plays a separated record as its four parts and doses each one
(`packages/song-schema/docs/stems.md`), and it can only do that over files that already exist. Minutes per song, so it is a command you run the
night before rather than mid-set.

**The chain is optional** and defaults to the machine's, `system stems`. Which module separates and
which model it wants is the same answer every time, so it is asked once and kept in
`preferences.yaml`; naming one on the line is the override, for the run that wants a different
model. A chain that treats rather than separates is refused either way, rather than quietly bouncing
thirty songs.

### `system stems <chaîne>` is the ONE place that answer lives

Every surface that could start a separation reads it — this verb, a desk's surface, the playlist
panel's button — and asking each of them would be asking the same question three times: which
module separates and which model it wants is a fact about the library and about this machine's
`<state>/models`, not about the set list in front of you.

k7's settings page sets the same answer with no command (*Separation chains*, apps/k7/frontend/docs/settings.md),
choosing only from the library's cold chains; this verb is the command-bar road to it.

It is **checked while it is set**, which is the cheap moment: a chain that does not separate is
refused there rather than thirty songs into a set list. A machine with no project open stores it
unchecked and says so, because a `@k7-core/…` ref has nothing to resolve against without one — not a
failure, since `system` verbs are meant to work from a shell that has opened nothing. `""` on the
line, quotes and all, is how you say "separate nothing" without a second verb.

### `system instrumental <chaîne>` is the same answer for a different question

A record without its voice is a second chain, not an option on the first: the same model, and a
module declaring `instrumental` as its single output instead of the four stems. What a caller
wants back is what decides which one is read, so each has its own standing answer and neither
surface has to hold a picker.

Its check is stricter. A chain that separates but declares no `instrumental` output is refused
here, because the failure it prevents is silent: four stems collected, one of them filed as the
instrumental, and a song that plays with its voice still in it.

`system stems` is resolved against the **open project's** module vocabulary, like every other cold step: that is
where a `@k7-core/…` ref becomes a module and a model becomes a path on this machine
(`packages/audio-passes/docs/processChain.md`). This is the one playlist verb that needs a project,
and it says so rather than throwing.

The songs are the **machine's copies**, under the médiathèque cache, because a deck opens file paths
and what matters is what is on this disk. Writing beside a song is safe: nothing prunes a song
folder of files it did not put there. The master is the FIRST audio file in a song's
folder and the scan does not descend — the médiathèque's own rule, restated here because this reads
the cache directly rather than through a scan of every song on the disk.

**Sequential and resumable**, and both halves matter for thirty songs on one machine:

- a song whose `stems/` already holds something is skipped — "already done" is a question about the
  FOLDER, not a flag anybody keeps, which is the same rule every "is this fresh" question in this
  repo asks;
- the separation registry hashes the WORK, so a re-run of an interrupted pass costs nothing twice
  and hands back the run already in flight;
- a failure is reported **per song and the loop goes on**: one unreadable file must not cost the
  other twenty-nine their preparation, and the line says which one it was.
