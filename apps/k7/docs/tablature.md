# The songbook: tablature, chords, diagrams

Three pure parsers — no framework, so unit-testable — turn raw text into something drawable.
Lyrics stay **strings in storage**; parsing happens only at display time.

## Tablature: a system is a run of lines, not a run of labels

`apps/k7/packages/tablature/src/tab.ts` reads the common ASCII format. It is monospaced, so a
character's index in the line **is** its x position and there is nothing more to compute.

A line counts as a string when, after an optional label, it holds only admitted characters:
dashes, bar lines, digits, spaces, and the usual technique letters (hammer, pull, bend, release,
slide, tap, vibrato, grace, let ring, muted, harmonic) plus a few symbols.

The string label is stripped from the front, but **the `|` that usually follows it stays in the
body**, so it draws as an opening bar line at column 0. The column where the body starts is
carried through so every string of one system aligns on the same grid.

A system is a **maximal run of consecutive string lines**; a blank or non-tab line ends it.
Splitting on labels is deliberately rejected: standard tuning names both the first and the sixth
string `E`, so a "label already seen, new system" rule would cut the last string into a system of
its own.

The accepted cost: two systems with no blank line between them merge into one tall block. Tab
exports separate them with a blank line.

## Chords: a known vocabulary, not "any letters"

`apps/k7/packages/lyrics/src/chords.ts` handles both grid styles — chords set above the lyrics
in monospace, and chords bracketed inside the text.

A chord's body is built from a **known vocabulary** of qualities, extensions and alterations
rather than accepting arbitrary letters. That is what stops ordinary words being read as chords.

Transposing moves only the root and any bass after the slash, independently, preserving quality
and extension; what is not a chord is answered unchanged. Across a whole line the **exact
spacing between tokens is kept**, to hold the chords' alignment over the lyrics as far as
possible. A token that changes width can still drift its column — the price of not rewriting the
line.

## Diagrams: one module touches the database

`apps/k7/frontend/src/utils/chordDiagram.ts` is the **only** module that touches
`@tombatossals/chords-db`, so the rest of the app stays decoupled from its shape.

Two frictions with it:

- `resolveJsonModule` infers a huge literal type whose `chords` object has no string index
  signature; a cast to our own shape is what makes `chords[key]` typable.
- Its property names are not note names — sharps are camelCase, some flats are kept as written,
  and enharmonics are folded — hence the `ROOT_TO_DB` table.

Lookup tries the exact quality, then the slash form, then the bare triad, and answers `null`
when the chord is not in the database rather than inventing a fingering.
