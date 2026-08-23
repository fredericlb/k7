# Naming things

The rationale behind `packages/song-schema/src/instanceName.ts` and
`packages/song-schema/src/songRef.ts` — how a thing this project makes is named after what it came
from, and how a project names a song in the médiathèque. `packages/song/docs/trackKind.md` covers the
third naming rule, a track's `[position.][prefix.]label`.

## `<owner>_<what>_<n>`

The rule existed twice over before it existed once: `moduleFork` minted `bs_lead_tape-delay_1` for a
copy of a shared module, and a node had no rule at all — a person typed its name into the command
bar. Both are the same question ("what do I call this use of that"), and a rule spelled in two places
is two answers (`packages/song/docs/nodes.md`).

`namePart` keeps one segment of the module vocabulary: `createNode` and `createModuleFile` both
refuse anything else, and a lane is called `vo.jo`, so it is not cosmetic. A name that survives as
nothing at all becomes `"x"`, since an empty segment would make `_1` the whole name — a file called
nothing.

`owner` is what the thing is FOR — the lane whose chain will play it — and it is dropped when there
is none: a module the project does not play yet, a node dropped on the bare canvas. `4osc_1` rather
than `_4osc_1`, which is the shape `moduleFork` already answered with.

The increment is always written, including on the first. Two reasons, and the second is the one that
matters: `vo_reverb` and `vo_reverb_2` would read as different KINDS of thing rather than as the
first and second of a series, and a name that has to be renamed to make room for a sibling is a name
that breaks every chain that spelled it.

`taken` is injected rather than read here so the file touches no disk: the service asks the project,
the browser asks the graph it is drawing.

## Renaming a use when the thing under it changes

`renamedInstance` returns null when the name is not one this convention made, and that null is the
whole point. `node replace` swaps the module a node extends, and a node still wearing
`vo_jo_reverb_1` while it extends a delay is a name that lies — but one somebody deliberately called
`wash` means `wash`, and renaming it would rewrite every chain that spells it to undo a decision.

BOTH shapes count as ours, and the one that matched is the one that comes back: a node born on the
bare canvas is `reverb_1` with no lane in it, and it keeps having none after it is spliced into a
run. Following the module it names is what was asked for; growing a prefix it never had would be a
second change nobody asked for.

The counter is NOT carried over — `instanceName` picks the first free one for the new stem.
`vo_jo_reverb_2` becoming `vo_jo_delay_1` looks like a step backwards and is not: the number counts
uses of THAT module, and there is one of the new one.

The module's NAME is what a use is called after, so two modules that clean to the same word leave
nothing to follow. Without that guard, replacing a module with itself would walk the counter up by
one every time and rewrite the chains to say nothing.

## A song ref

`songRef.ts` is a leaf with no imports at all: the browser lists a set's songs and must not pull
`node:os` in with the word (`mediatekRoot.ts` opens one). `MEDIATEK_REF` lives here rather than in
that file, which owns the rest of the library's layout — the same reason `CHAINS_FILE` sits in
`@studio/mediatek`'s `types.ts` and not in its scan. `mediatekRoot` re-exports it, so nothing that
already imported it from there had to change.

A song ref is `@st0/` plus the médiathèque id, VERBATIM. A `MediatekEntry.id` is the entry's
library-relative POSIX path (`songs/artist/album/title`) and the catalogue's own note says nothing
else survives a rescan. A ref that IS the id therefore needs nothing resolved to be compared,
deduplicated or fetched — the resolution is a lookup, not a computation, and a ref that resolves to
nothing is still a well-formed name for the thing to go and fetch.

A MODULE ref omits its family (`@st0/audio/reverb` means `modules/audio/reverb`) because that
vocabulary predates the médiathèque having families. The two are not made consistent: rewriting every
song already written would cost more than the asymmetry, and they are read by different files, so
nothing has to tell them apart at a distance.

**Spaces are legal in a ref, and that is not a detail.** A médiathèque id is built from the tags —
`songs/Alain Bashung/Album inconnu/La nuit je mens` is a real one — so a pattern that banned
whitespace refused nearly every set list anyone would actually write. `SONG_REF` is strict about
STRUCTURE (no empty segment, no trailing slash, one line) and says nothing about the characters a
segment may hold, because the médiathèque is what decides those and a ref is compared to its id
verbatim.

`songPathPrefix` answers a folder with its trailing slash rather than the sidecar's path, because a
song IS its folder: the master, its variants and `song.yaml` are all of it, and a sync that fetched
only the file named would land a catalogued folder with nothing to play. Same rule, and the same
reason, as `mediatekPathPrefix` for a module.
