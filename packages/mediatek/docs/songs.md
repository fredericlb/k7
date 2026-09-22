# song.ts — extended notes

Vocabulary: **storage** and **code** are in English (`songs/`, `song.yaml`, `addSong`), **prose** and
the **interface** are in French. What `songs/` holds is a **morceau**, and the tab reads
« Morceaux » on screen.

## `songs/` is not hand-edited

The other two families behave like a folder: the mediatek tree creates, renames, moves and deletes
in them. `songs/` only **deletes a song** and **fills one** — its shape is a rule, not a convention:

```
songs/<artist>/<album>/<title>/original.<ext>
                               song.yaml
```

The scan starts at the family root, stops at the first folder carrying a `song.yaml` or an audio
file, and takes that folder for an entry. A folder created by hand at the wrong level therefore does
not produce a badly filed entry: it produces an invisible one, or worse, it swallows the folders
below it.

Hence the button, and hence its being the **only** way into this family: you send three fields, the
library builds the path.

### Leaving, though, is a right-click

What the tree is forbidden is **placing** something where the tags asked for nothing: create,
rename, move. Removing a song says nothing about the shape — the folder goes whole, master and
sidecar with it, and nothing is left to misfile. Without this entry it would be the one operation
forcing you to leave the application for the volume, which is dear for a failed import.

### …and adding a variant places nothing either

The other menu entry, « Ajouter une variante… », writes **inside** a song that already exists: an
audio file beside the master, and the `song.yaml` line declaring it. The same gesture works by
dropping the file on the song's row. None of it chooses a path — the folder is the one clicked, the
file name is derived from what is sent — so the rule above still holds. See
[variants.md](variants.md).

### Those two entries, and only on the right row

The family's context menu therefore has only these two, and neither appears anywhere but on the row
that **is** a song: above it are the artist and the album, segments derived from tags rather than
folders someone made — deleting them would take everything below, and a variant of an album means
nothing. On those rows no menu opens at all and the browser's own takes over (see
`commons/packages/ui/docs/file-tree.md`).

What is locked is the **tree**, not the content: `song.yaml` edits like any YAML, in the split
screen pl8 opens on clicking a song (see `apps/pl8/docs/songPlayer.md`). The sidecar is the truth —
the displayed title, the tempo, the variants — and the folder is only an address; correcting one
therefore moves nothing.

## No provenance level — three segments, never four

The tree carries no fourth level at the top — `imported/` for someone else's master, `recorded/` for
what the studio produced. Two reasons, in this order:

1. **It would separate the wrong thing.** What deserves to be apart is not "who produced this
   master" but "is this catalogued or is it raw material". And that separation already exists:
   `recordings/` is a zone at the root, with its own revision token, outside every manifest (see
   [recordings.md](recordings.md)). An `imported|recorded` level would double a boundary already
   drawn elsewhere, and draw it worse.
2. **Almost nothing would read it.** It would land in `MediatekEntry.kind`, where the only surface
   able to show it is a badge in the list. In exchange it would put every song one notch below its
   artist, and force every caller able to write — k7 publishing, the upload button — to choose a
   word for something the sidecar already says better.

What suffices is `source:` in `song.yaml`: `upload` for the mediatek's button, `k7` for a published
version, `mirror` for a copy pulled back. A line in a file, not a level in a path — readable without
listing the parent folder, and changeable without moving bytes.

Anything other than `upload` is filed but not BROWSED: `scanSongs` leaves it out of the family's
listing entirely, so a published k7 release never shows up beside what the button filed by hand. It
still lives under `songs/`, at the path its tags built, and a caller that already knows that path —
k7 fetching its own `AudioPath` — reads it directly, never through the catalogue.

Direct consequence: `songFolder()` always returns four segments (`songs` + the three tags), and two
tests check that **by the count** rather than against an example path — a fifth level would appear
silently, as a nested folder a string comparison would not notice.

The other consequence is that `kind` is `""` for this family. Deliberately an empty string and not a
borrowed word: this family does not divide, and an entry that says so is honest where a default
"imported" would lie.

## The client never sends a path

`POST /api/mediatek/song?artist=…&album=…&title=…` carries the bytes and three strings. The path is
built server-side by `songFolder`, never received.

Not cosmetic. `PUT /file` accepts a path because both its callers legitimately have one (an editor
saving its YAML, a machine pushing a tree it already owns). An upload has none: it has tags, which
come from a file downloaded somewhere. Letting those become a path is letting `AC/DC` open a folder
and `../..` climb two — `safePath` would catch the second, nothing would catch the first.

`segment()` therefore reduces each tag to a nameable segment: accents decomposed then stripped
("Café" → "Cafe", not "Caf" as a plain `\w` filter would give), separators and characters forbidden
on any of the three systems replaced by a space, trailing dot or space removed because Windows
silently refuses such a name at rename time, 80 characters at most.

The exact spelling survives in `song.yaml`: that is where the catalogue takes the displayed name
from. The folder is an address, the sidecar is the truth.

## An empty field names the hole

A file with no album tag files under « Album inconnu ». Refusing the upload would be cleaner on
paper and unusable in practice: half a downloaded record has no album tag, and a song filed under a
readable name is a song you can find and rename. A refused song is nowhere.

## Tags are read in the browser

`music-metadata` runs frontend-side, on the chosen `File`, and fills the dialog. Three intended
consequences:

- **you see the path before sending.** The dialog shows exactly what the server will build, by
  calling this module's own functions — not a second version of the rule, which would end up
  diverging;
- **you correct before sending**, which beats renaming three folders after;
- **the backend does not have the dependency.** It receives three strings and parses no audio
  container, so a malformed mp3 cannot bring it down: at worst it becomes a form to fill by hand,
  which the dialog already allows.

A file the library cannot read is not an error either: the file name is then the best source
available, and `tagsFromFilename` gets "01 - Artist - Title" out of it when the convention holds.

## Nothing is re-encoded

The master is called `original.<ext>` — the extension of what was sent. A flac stays a flac. Naming
the file `original.mp3` regardless would imply a transcode, so `ffmpeg` in the image, quality lost
on a master, and a wait on every upload.

The stem is fixed for the opposite reason: a consumer holding the folder finds the audio without
listing. The scan's `master()` remains authoritative all the same — it is what fills `meta.master`,
because a folder can also come from the k7 mirror, where the file is called `master.<ext>`.

## Already there is a 409, not an overwrite

Two uploads deriving the same folder are almost always the same song sent twice. The second is
refused with a 409: a silent overwrite is the one result the sender cannot undo, and "it is already
there" is information they want.

The dialog turns that 409 into a question — replace, or change one of the three fields to file it
elsewhere. A replacement in another format deletes the old master: two `original.*` in a folder, and
the scan plays whichever `readdir` returns first.

It is the inverse of `ingest.md`'s rule, where a PUT replaces without asking. The difference is the
caller: pushing a workspace is a deliberate act aimed at a named folder, sending a file from a
browser is not.

## The sidecar is written last

`addSong` places the folder, then the master, then `song.yaml` — in that order, as the mirror does
and for the same reason: a failure in the middle then leaves an uncatalogued folder, not a catalogue
entry pointing at nothing. The scan can read the first case (a folder with audio and no sidecar is
listed anyway); the second would be a song with no bytes.

## `bpm:` is detected once, then edited

`setSongBpm` **never overwrites**. `bpm` is a field a person corrects, and the detected value is only
a starting point: the engine's estimate drops an octave on fast material (see
`packages/file-service/docs/waveformCache.md`). Re-analysing a song must not undo a correction, so a
key already present — whatever its value — wins.

A `bpm` of 0 is the engine's "found nothing" and writes nothing: an explicit zero in the file would
read as an assertion, where absence is the honest state.

**`force` is the corrector's door.** The no-overwrite rule exists to protect a correction from a
RE-ANALYSIS, not from the person correcting: the desk's `÷2` / `×2` buttons therefore send `force`,
and replace. Without it a first wrong detection would be final.

## `key:` is typed, never detected

The key lives here for the reason the tempo does: it is a fact about the RECORDING, and it does not
change from one set to the next. C sharp minor stays C sharp minor in every project that plays the
record — hence `song.yaml` and not a set's `mix.yaml`.

```yaml
key: "C# minor"
```

**Quoted, and that is not cosmetic**: a bare `#` mid-value opens a YAML comment, so `key: C# minor`
reads back as `C` and the mode disappears without a word. `setSongKey` always quotes, and a test
pins it.

It is the KEY that is stored, not its Camelot code: the wheel is a rendering — `12A` — and keeping
the rendering would lose the mode's name. The desk converts for display.

And it is **typed**. A detector measured against seventeen hand-labelled songs gets 53 % of keys
exactly right, which is enough to lie and not enough to serve
(`docs/key-detection-plan.md`). A typed key is right, and a playlist is twelve to thirty songs — not
two hundred and seventy-nine.

## The other two families: you drop a folder

`modules/` and `samples/` behave like a tree, and a **module is a folder** — `module.yaml`,
`ui.yaml`, `presets.yaml` (see `@studio/song`'s `docs/uiLibrary.md`). "Add a module" is therefore a
folder drop, not a file drop.

The browser does not give that free: `dataTransfer.files` is a flat list that cannot carry a
directory, so a dropped folder would arrive **nowhere, with no error**. The shared tree reads the
drop through `webkitGetAsEntry` and returns each file with the path it occupied (`onDropTree` — both
traps are in `commons/packages/ui/docs/file-tree.md`).

On this side, `uploadTree` does one `PUT /file` per file under `<dropped folder>/<path>`: `putFile`
creates the intermediate directories, and `writablePath` refuses anything leaving the root. A `..` is
therefore stopped where it always is, not in the client.

And a **folder picker** in the tree's context menu, beside the drag: a drag-and-drop that fails does
so silently, which makes it a bad sole entry. It is a second `<input type="file">` with
`webkitdirectory` — the property belongs to the input, not the click, hence two hidden fields rather
than one.
