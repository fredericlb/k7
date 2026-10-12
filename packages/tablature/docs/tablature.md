# Tablature

`@studio/tablature` reads ASCII tablature out of a song's text and draws it. Like the chord parser
beside it (`packages/lyrics/docs/chords.md`), the parser is pure — no framework, so unit-testable —
and the text stays a **string in storage**; parsing happens only at display time.

## Tablature: a system is a run of lines, not a run of labels

`src/tab.ts` reads the common ASCII format. It is monospaced, so a
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
