# Editing a `.z0` session

What the editor does with the files, and why it goes about it that way. The SHAPE of the files
is in [projects.md](projects.md); this page is the screen on top. What it deliberately does
**not** do is at the bottom — read that before concluding something is missing by accident.

## A file is not a record

The source is a YAML file in a git repository, written by a generator *and* by humans, commented,
and reviewed as a diff at commit time — not a row in a database that could be read back and
rewritten without the question of text ever arising.

Hence the rule that governs everything else:

> Modify the **document**, never the values pulled out of it.

`format.ts` therefore keeps one `yaml` **Document** per file and writes into it (`setIn`,
`deleteIn`, a splice on the node for a move). The naive path — `parse` → JS object → `stringify` —
produces a file equivalent *to a parser* and unrecognisable to a person: comments lost, quotes
normalised, key order redone, and a 400-line diff for having moved one `start`. The test holding
this rule is "changes one scalar and nothing else", and it checks explicitly that the header
comment and `notice:`'s quotes survive.

Four less obvious consequences:

- **A `Document` must survive rendering.** Re-parsing on every keystroke would make the
  preservation pointless, so the documents live in `store.ts`, not in a `useState`.
- **Clearing a field DELETES it.** `setTrackField(..., undefined)` does `deleteIn`. Writing
  `end: 0` would add a line to every song merely looked at, and `0` is not what an absent end
  means — that is "to the end".
- **`false` counts as empty**, deliberately: `format.ts`'s `empty()` treats `undefined`, `""` and
  `false` alike, because `liveOnly` is absent or true in every file. Unticking the box must remove
  the line, not write `liveOnly: false` — same meaning, and a spelling that exists nowhere else.
- **An empty `effects:` does not exist either.** `setSongEffect` makes the table appear with the
  first value and go with the last: an `effects: {}` would be the only one in the whole corpus,
  and that is not what an untreated song looks like.

## A song has two shapes and one address

The format writes a single-track song **flat** (`song:` on the song itself) and a multi-track song
under `tracks:`. The two keys are exclusive.

`readCategory` normalises that once: a flat song becomes a song with **one** track, and
`flat: true` remembers the real shape. The rest of the application never branches on the two
shapes; only `trackPath()` does, and that is the one place it is written.

Adding a second track to a flat song **promotes** it (`expandToTracks`): the track keys drop into
a list, the song keys (`label`, `status`, `speed`…) stay where they are. It is the only shape
transformation the editor makes, and it is idempotent.

Removing the track of a **flat** song is refused: there is no track node to remove, the keys are
the song's, and "folding back" would delete its fields with it.

The other way round: removing the **last** track of a song under `tracks:` leaves the list empty
rather than folding the song flat. A song with no track is a visible error you go and fix; a
silently folded song is a *different* song from the one being edited.

## The start and the end

That is the point of the screen. A blindtest plays an excerpt, and choosing it is done by ear:
`TrackPanel.tsx` decodes the audio, draws a waveform, plays all of it or only the window, and sets
the bounds from where you are listening ("Début ici" / "Fin ici").

A `.z0` stores only a médiathèque id, so `mediatek.ts` resolves the address to a file. The
resolution rule is **the game loader's**, not an invention here:

> the version the category asks for if it exists, otherwise the master.

Departing from it would have the author listening to a different file from the one the game will
play, which is exactly the mistake an excerpt editor must not permit. `mediatek.test.ts` holds it,
including the case of covers whose `original` **is** the cover.

`mode: reversed` (the `a-l-envers` category) reads backwards, and `speed` changes the rate: those
are the only two treatments the format still carries, so the only two the preview applies.

## The médiathèque is optional

The catalogue is loaded **after** the files and never before: it serves labels and audio only. A
broken médiathèque must still let the session open and be edited — a banner says so, songs show by
their address, the preview is unavailable, and writing works.

That is also what makes the song picker answer keystrokes without a request: the list is already
in memory.

## Saving

Debounced at 800 ms, then one `PUT /file` per modified file. `Ctrl+S` means "now", not "at all" —
the same rule as st0's editors
([autosave.md](../../../packages/ui-editor/docs/autosave.md)).

A failure **puts the files back in the queue** and shows it. A silently lost edit is worse than a
visible error, and the tab is the only copy of what is not yet written.

The **YAML** button shows the document as it will be written, unsaved edits included. It is not a
second view of the same file: it is the check on what the editor is about to commit.

## What it deliberately does not do

- **List sessions and open one.** This editor is opened ON a project by its address, and the
  choice happens on st0's home page. A second picker is exactly what
  `packages/project-shell/docs/launch.md` refuses.
- **Upload audio** onto a track. Audio lives in the médiathèque, and putting it there is pl8's
  job. A track names an address; it carries no bytes.
- **Reuse a category.** A category is a file, and two rounds on the same one are done with
  `songs:` in order. The picker (`SongPicker`) is therefore over SONGS, over the médiathèque.

What it does do and people look for elsewhere: per-song effects are edited under
`effects: { … }` — `categories/deformees.yaml` carries
`effects: { bitreduction: 78, chorus: 100, … }` song by song — and a track carries `youtube:`,
`file:`, `artist:` and `title:` beside its address.

## Two shapes the format documents badly

Real files carry two that [projects.md](projects.md) barely mentions, and that a naive setter
damages without breaking anything visible:

- **`answer:` is a literal block** (`answer: |`) in all thirty cases of session 2304 — several
  accepted spellings, one per line. Writing a multi-line value with an ordinary `setIn` would fold
  it onto one quoted line: same value, unrecognisable diff. Hence the **textarea** field and
  `format.ts`'s `Scalar.BLOCK_LITERAL`.
- **`effects: { … }` does exist**, per song — the `multi` example in
  [projects.md](projects.md) shows one, and `deformees.yaml` carries one per song. Two mechanisms
  coexist: a variant when the treatment is *recorded* in the médiathèque
  ([effects.md](effects.md)), `effects:` when it is computed at playback.

And a third detail, invisible until you write: a pause with no message is `- pause:`, whereas
`yaml` writes `null` by default. `serialize()` therefore emits documents with `nullStr: ""`,
without which a pause added here would be written `- pause: null` next to those already on disk —
same meaning, two spellings, and a diff on every file touched.

## What is still missing

- **Reordering the tracks** of a multi-track song (they can be added and removed, not permuted).
- **Renaming a category's file**: the slug is fixed at creation. The displayed name changes
  freely — that is `name:`, not the filename.
- **No whole-file validation**: nothing flags a category no round plays, nor a song whose address
  no longer answers. A round's range is checked against its category, and that is all.
