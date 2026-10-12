# Chords: a known vocabulary, not "any letters"

`src/chords.ts` handles both grid styles — chords set above the lyrics
in monospace, and chords bracketed inside the text.

A chord's body is built from a **known vocabulary** of qualities, extensions and alterations
rather than accepting arbitrary letters. That is what stops ordinary words being read as chords.

Transposing moves only the root and any bass after the slash, independently, preserving quality
and extension; what is not a chord is answered unchanged. Across a whole line the **exact
spacing between tokens is kept**, to hold the chords' alignment over the lyrics as far as
possible. A token that changes width can still drift its column — the price of not rewriting the
line.

Tablature inside the same text is the tablature package's (`packages/tablature/docs/tablature.md`);
the timecodes a line may carry are [timecodes.md](timecodes.md).
