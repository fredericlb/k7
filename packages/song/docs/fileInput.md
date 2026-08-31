# `io: file` — an input that reads a file

An io module is where signal enters or leaves a song. Three roles: `in`, a live interface
channel; `out`, a sink; and `file`, whose audio comes off disk:

```yaml
# modules/io/FILE/take.yaml — one use of the engine's FILE input
io: file
source: "clips/original.wav"
```

The engine offers it as `@engine/FILE`, beside `@engine/IN` and `@engine/OUT`. One module for
the app; a node carries which file, exactly as an `IN` node carries which channel.

## Why a role and not a flag

Because the graph decides "sink" by **elimination**: an io module is a destination unless it
declares itself a source. Spelled `io !== "in"`, that rule makes a role added without a word a
sink silently — and a chain would then be allowed to route *into* the thing meant to feed it,
with no warning anywhere.

`moduleTypes.IO_SOURCES` is that list, and `graph.ts` reads it rather than restating it. Adding
a fourth role means adding it there, and the test that pins this
(`fileInput.test.ts`, "is not somewhere a chain can route TO") fails if you don't.

## Why `source:` and not `file:`

`file:` is the obvious spelling and it is taken. The loader writes the module's **folder name**
to `file` when it decorates a module, so an authored `file:` is overwritten before anything
downstream can read it — silently: such a spelling passes its schema and still loses the value.

`source:` is also what the rest of the format already calls this fact: a clip's audio is
`source:`, a slice rack's is `source:`. Same word, same meaning.

## Absent is the useful case

A chain **template** — the médiathèque's `graph.yaml`, `@studio/mediatek`'s `docs/chains.md` —
is generic by definition: it says how to treat something, not what to treat. Its input names no
file, and whoever applies the template supplies the audio. A morceau hands over its master (see
that package's `docs/variants.md`), and the drawing then says which file goes through the chain
instead of repeating the placeholder.

So `source` is optional, and a node with none is not half-written.

## What it is NOT

`isInputModule()` stays narrow — `io === "in"` only. Everything it gates is about a *physical*
input: which track it lands on, whether you monitor it, its trim, whether the rig has a channel
by that name, the tuner. None of that means anything for a file. `isFileInputModule()` is the
separate test; the two share `emits: "audio"` and nothing else.

For the same reason a FILE module is skipped by `ioPorts()`: that panel is the rig — channels
and levels — and a file source has neither. Left in, it would be filed as an *output* (everything
that is not `in` is) and drawn with no channels at all.

## What is not wired yet

Playback **from a song**. The role, the field, the catalogue entry, the graph's treatment of it
and the drawing are here; nothing compiles a FILE module into a `ProjectDoc` from a song's own
YAML. In a song, audio reaches the engine as a clip on a track, and making a file input compile
to that is the piece still to write — deliberately not guessed at here, because the shape a song
wants may differ.

The **médiathèque** did not wait on it: `songPreviewDoc` built that document by hand — the song's
master as the clip, the chain's steps as the track's plugins — which is what auditioning a chain
and bouncing a variant ran on. It went with pl8's engine half, and no surface has replaced it. See
`packages/mediatek/docs/variants.md`. What is missing is the *authored* path: a `modules/io/FILE`
node in a project folder compiling to the same thing.
