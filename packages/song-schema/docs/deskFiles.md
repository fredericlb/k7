# The desk's two files

The rationale behind `packages/song-schema/src/yaml/mixSchema.ts`,
`packages/song-schema/src/yaml/mixFile.ts`, `packages/song-schema/src/yaml/mixViewSchema.ts` and
`packages/song-schema/src/yaml/mixViewFile.ts`. What a set project IS lives in
`packages/song/docs/mixFile.md` and `packages/song/docs/viewBindings.md`; this page is the file
shapes and the reader/writer rules.

Both readers are browser-safe (no `fs`), because the app that DRAWS a desk is the one that needs
them. Both pin YAML 1.2 for the reason every other file here does: a scalar shaped like `5:1:1` stays
a string. A ref carries no colon today, and the day one does it must not silently become a number; a
param name is arbitrary text and must not be reinterpreted on the way in.

## `mix.yaml` — the cue sheet

`MIX_BASE` is named once and every reader takes it from here rather than spelling it, which is what
`views/mix.yaml` is NOT.

A song's cue points are positional, by BUTTON: the desk has eight. `null` is an empty slot, so button
3 stays button 3 whatever happened to 1 and 2 — a cue is muscle memory, and a list that closed its
gaps would renumber somebody's set mid-gig. Only the trailing empties are dropped, which is why a
song with one cue on button 1 writes one number rather than eight. They are SOURCE seconds into the
file, never the transport's: a deck's timeline position depends on what the tempo fader is doing;
where the drop is does not.

An entry is a bare ref OR a ref that carries its cues, on purpose. A song with nothing to say stays
ONE LINE, and a bare ref is what a song goes back to when its last cue is cleared — so a set nobody
has cued reads as a plain list. The alternative, a map of refs to mostly-null, would have made every
entry look as though something were missing.

`cues:` is a SEQUENCE and not a map, although the list is unordered and a map is what `graph.yaml`
uses for "named exactly once". Duplicates are dropped on read rather than refused: two people merging
their halves of a set should not have to resolve that by hand.

The ref vocabulary itself is `songRef.ts` — a leaf, so a browser can hold it without a YAML parser.

### Reading and writing it

A bare sequence at the root — `- "@st0/songs/…"` with no `cues:` key — is named precisely rather than
reported as "expected object": it is the first thing anyone writes, and the fix is one line.

`cueRefs` sorts, because the list is unordered and something has to decide what a reader sees first.
The file's own line order is therefore not meaningful, which is the point: a set's running order is
decided at the desk, not in git. `cueMarkers` hands the slot list back exactly as the file wrote it,
trailing empties absent rather than null, so a caller reads a missing index as an empty button too.

`withMarkers` edits the parsed document and re-prints it. A round trip through `toJS()` and a dump
would rewrite the file: the scaffold's comments are the one worked example a reader of a set gets,
and a desk that ate them the first time somebody dropped a cue would be a desk nobody forgives.

A ref the file does not name is APPENDED. That is not a courtesy: a deck can be playing a song
somebody removed from the playlist a moment ago, and refusing the cue would lose a gesture the DJ has
already made. Trailing empties are trimmed, and a song whose last cue is cleared goes back to a bare
ref — so a sheet nobody has cued reads exactly as it did before any of this existed. The cues are
written on one line, since eight numbers down the page would bury the ref they belong to.

## `views/mix.yaml` — the bindings

Keyed by the CONTROL, because the file is about a desk, so a control drives at most ONE param — two
targets on one fader is a thing you cannot see going wrong. The reverse is allowed and useful: two
controls may name the same module and param, and both move it.

`module` is the chain's name for it — `crossfade`, `tempoA` — and not a médiathèque ref: a node is
what a set actually has two of, and a ref would be ambiguous the moment a module is used twice. That
ambiguity is the whole reason these bindings are not in the module's own `controller.yaml`, which
belongs to the device and is shared by every use of it. `param` is spelled exactly as `ui.yaml`'s
`bind:` spells it, so the binding, the panel and a MIDI map all line up key for key and can be read
side by side.

**`null` is a real value**, and it is what a scaffolded surface is made of: every component the desk
has, listed, each waiting for a module. Absent and null mean the same thing to everything downstream
— `unmappedControls` reports both, because both are unwired — and the difference is for the person
reading the file: a key that is there tells you the component exists and what it is called, which is
precisely what you need to fill it in. Without it a skeleton could only be comments, and a comment is
not something a parser will ever tell you that you got wrong.

The control ids are NOT validated here. They are the app's vocabulary — the desk knows what a
`crossfade` is and this package does not — so an unknown id is reported by whoever draws the panel,
against the list it actually has. A schema that guessed would go stale the day a control is added.

An EMPTY file is a desk with nothing bound, which is the state every project starts in, so it is not
reported. (A `surfaces/` file parts company with this: see `surfaceFiles.md`.)
