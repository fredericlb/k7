# A module's second input

A module declares its own input ports — `packages/song/docs/ports.md` is where that starts, and
where the chains syntax (`crossfade#b`) lives. This page is the other end: how a second signal
actually reaches a `GraphDspPlugin`, and why it takes the shape it does.

## Tracktion already does this

A second input does **not** mean turning a track from a linear plugin chain into a node graph,
which is the assumption that makes this look expensive. Tracktion routes a second signal into a
plugin already, and `CompressorPlugin` is the consumer in the tree to copy:

- `Plugin::getChannelNames(ins, outs)` — a plugin asks for input channels beyond the stereo pair
  (the compressor adds one, `"Sidechain Trigger"`);
- the extra signal arrives **in the render buffer**, past channel 1;
- `setSidechainSourceID(EditItemID)` says which track feeds it, and the plugin's *wires* say which
  of that track's channels land on which of its own.

None of this is new machinery. What differs is that the routing is decided by a **song file**
rather than by a user dragging in a UI.

## A pair per port, not a channel

`GraphDspPlugin::getChannelNames` adds **two** channels per input port past the first, so port *n*
is the pair `2n / 2n+1`. That is a choice, and it is the one Tracktion's own default routing makes:
`guessSidechainRouting()` with four input channels wires source L→2 and source R→3. Ask for a
single mono channel instead and the same routine sums the source's two channels into it — correct
for a compressor's trigger, wrong for a crossfade, whose second input is a signal you hear rather
than a level you measure.

The pair is also what makes `DspGraph` arithmetic instead of a lookup: `ain` carries a port index,
and reading it is `base = port * 2`. No names cross the gap between the module file and the graph.

## Where each piece sits

| where | what it does |
|---|---|
| `@studio/dsp` — `input(n)` | emits `{ "type": "ain", "port": n }`; port 0 emits no field at all |
| `DspGraph` | `Kind::ain` reads channels `2n / 2n+1`, and `inputs()` reports how many ports the description names |
| `GraphDspPlugin::getChannelNames` | a stereo pair per port past the first |
| `GraphDspPlugin::canSidechain` | true when the graph declares more than one input |
| `PluginDoc::sidechainFrom` + `server/DocJson.cpp` | the source TRACK id, on the wire |
| `EditBuilder` | `setSidechainSourceID` plus `guessSidechainRouting`, in a pass of its own |
| `ProjectDiff::keyOf` | folds the source into plugin identity, so re-aiming a cable is not an empty diff |

Two of those deserve a sentence.

**The pass of its own.** The source is a track, and a track has no `EditItemID` until it has been
made — so wiring it inline while plugins are being inserted would find nothing whenever the source
lane comes later in the doc. It runs after the track loop, beside the aux sends, for the same reason
they do.

**The diff key.** The sidechain is wired exactly once, when the plugin is inserted, and nowhere
else. Left out of `keyOf`, moving the cable in the song is an *empty diff*: the file says one thing
and the engine goes on playing another, with nothing on screen to suggest it. Folding it into
identity makes a re-wire read as a replace, which rebuilds.

## Muting the source still feeds it

Worth knowing before you go looking for a bug: Tracktion's muting node **deliberately** lets clips
through to aux sends and sidechains. So a lane muted at the master still delivers its signal to a
plugin that names it as a sidechain source.

That is not a quirk to work around, it is the mechanism a song needs. In the compiler's model
`out` is a parallel path — the dry signal carries on to the master, which is what makes a send a
send — so a deck feeding only a crossfade's second port would otherwise be heard twice. Muting it
says "through the module only", and the sidechain is unaffected. `crossfade-demo` relies on it,
and `packages/song/docs/ports.md` says why from the song's side.

## An unfed port is silence, not a failure

`mandatory: false` says wiring one side and leaving the other quiet is a legitimate state. Tracktion
caps a plugin with no sidechain source at two channels, so that state arrives as a buffer that
simply has no channel 2 — and `ain` reads zero rather than past the end. That is the behaviour, not
a fallback.

## Measured

Two renders of the same doc: two tracks playing the same 220 Hz sine at 0.2, a graph on the first
summing `ain(0)` and `ain(1)`, the second track muted so only the sum reaches the master.

    sidechainFrom: "b"   peak 0.2832
    (omitted)            peak 0.1416

Exactly double, and the 0.1416 is the 0.2 source through Tracktion's default −3 dB pan law. The
signal flows. `tests/DspGraph_test.cpp` pins the same three facts at the graph level (the port
count, the pair it reads, the silence when nothing feeds it), and `crossfade-demo` is the same
proof through a real song — the numbers are in the song layer's page.

One warning about measuring this: `--render` writes into a directory that
may already hold a previous `mix.wav`. Reading a stale one is indistinguishable from a render that
produced silence, and it sends you bisecting a doc that was fine all along. Render into a fresh
directory, and check the process's exit rather than piping it to `/dev/null`.

What stays unverifiable here is *listening*: a render can be measured, never judged.
