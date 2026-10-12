# A recorder node — capturing what goes through a point

Recording in this app was a **track-and-transport** affair: arm a lane, roll the transport, and a
finished take becomes a clip ([recordTake](../../take-render/src/recordTake.ts)). That shape has
no answer for the thing a rig is for — *capture what is passing through here, now* — because a
`live` project has no arrangement and never presses play ([liveProject.md](liveProject.md)).

So: a node you wire into a chain.

```yaml
modules:
  IN:    [ fader ]
  fader: [ MIX ]
  MIX:   [ rec ]     # …and the sound is unchanged whether it is recording or not
  rec:   [ OUT ]
```

Anywhere in the graph works — the `live` archetype puts it on the master run, and the section
below says why that is the placement worth having.

```yaml
# nodes/rec.yaml — one USE of the shared module, as any node is
extends: "@meta/audio/recorder"
```

It is an ordinary module with an engine built-in behind it (`plugin: {type: internal, name:
Recorder}`), so `node bypass`, `graph move`, `node delete` and the compiler all work on it with
no knowledge that it records. **It has no params**: its three controls are intrinsics that FIRE.

## The three buttons

| bind | what happens | who does it |
|---|---|---|
| `@rec:record` | start, or stop and keep the take | the ENGINE, down the socket |
| `@rec:clear` | drop the most recent take, file and all — **stopping it first** if it is still rolling | the ENGINE |
| `@rec:save` | send the take on top to the médiathèque's `recordings/`, **then clear it** | a VERB, then the engine |

`clear` acts on a take being WRITTEN as readily as on a finished one: one press stops it and drops
it, which is what a rig wants from a button that means "no, not that". It asked only about
finished takes at first, so clearing the very first take of a session was refused as "has recorded
nothing to clear" while it was plainly recording.

`save` clears on the way out, and **only when the save succeeded**: the bytes are in the
médiathèque now, so a stack that kept them would offer the same take again — but a save that was
refused (no médiathèque configured, a path outside the record directory) must leave the take
exactly where it is. That is why the card runs this one itself instead of through `runCommand`,
which reports a refusal without returning one.

The first two write nothing to disk, so they are **not verbs**: there is no file change to
journal and nothing for undo to restore. Saving moves bytes, so it is a verb like everything else
that does — `node record save <file> [name]`.

They are `@rec:…` and not `@record`, and the prefix is load-bearing: a bare `@field` is what
`widgetTarget` resolves as a module FIELD to write, so `@record` would quietly become
`node param rec @record …` and write a key into the node's file. `recBindVerb` is checked ahead of
that arm, exactly as a rack pad's `@rack:` is
([widgets.md](../../ui-chains-react/docs/widgets.md)).

## Why `save` is not an engine action

The take is a wav the engine wrote, on the engine's machine. Three things could send it to the
médiathèque and only one of them is in the right place:

- the **engine** has the bytes but no business knowing what a médiathèque is — it receives a
  compiled document and plays audio;
- the **browser** has the médiathèque but not the bytes, and shipping a take through it to send
  it back out is a round trip over the network for nothing;
- the **file service** runs on the engine's machine and already holds `mediatekBase()` and the
  token. `pushRecording` was already there.

So the engine's job ends at a file, and `recorderSave.ts` reads it.

### The path is CHECKED, not trusted

What the browser sends is a path it read off a state frame. It is verified to be inside the
project's own `recordDir` before anything is opened — `insideDir`, resolved on both sides so `..`
cannot walk out, and separator-aware so `/takes-old/x.wav` cannot pass for being inside `/takes`.

A browser naming any file on the machine is the failure this exists to prevent, and it is cheap
enough that there is no argument for trusting the frame instead.

The path travels **JSON-quoted** — `node record save "C:\\Users\\…\\rec-1.wav"` — and
`firstArg` in [commands.ts](../../commands/src/commands.ts) parses it back with `JSON.parse`.
Nothing else survives the trip: a take's path is absolute, on Windows it is full of backslashes,
and a project folder may hold a space. Merely stripping the quotes, which is what the other verbs
do to a node name, hands the check `C:\\Users` and it refuses a take that was right there.

The take is stamped with its own **mtime**, not with now: a take saved an hour after it was
played belongs to the hour it was played, and the médiathèque files by day
([recordings.md](../../mediatek/docs/recordings.md)).

## What the card SAYS

Two states and no third, decided in one place
([takeClock.ts](../../ui-chains/src/takeClock.ts)):

- **nothing to show** — not rolling, and no take on the stack: the card reads `no record`, and
  **no waveform is drawn at all**. An empty envelope beside those words reads as a broken meter
  rather than as an idle machine, so the paint returns early rather than drawing its centre line.
- **something to show** — a clock, over the picture. Counting UP while a take is being made, and
  the finished take's LENGTH once it has stopped.

`message` and `elapsed` are never both set, which is what lets the card decide "waveform or not"
on one field.

The length has to come off the take itself: the engine sends `seconds: 0` when it is not rolling
(`r.seconds = node->recording ? node->seconds() : 0.0`), so a card reading that field would show
`0:00.0` for every finished take. Rolling wins over a finished take, too — the clock counts the
take being MADE, not the one before it.

## The waveform is the take, not a tap

`source: take` on the waveform widget. The two live sources (`input`, `output`) draw a rolling
window through a tap the engine inserts on demand; a recorder draws **the whole take, growing**,
off the state frame — and needs no tap at all, since it is already in the chain.

Each frame carries only the points made since the last one, so somebody accumulates. Knowing when
to throw the total away is the entire difficulty, and it lives in
[takeEnvelope.ts](../../engine-browser/src/takeEnvelope.ts): a new take starts, a take closes, or
`clear` pops the one on screen. Get it wrong and a take draws on top of the last one, which reads
as a rendering bug for ever.

**A reload gets the whole picture**, because every frame also says WHERE its points start and the
engine rewinds that to 0 for a socket that just connected
([recorder.md](../../../engine/st0-engine/docs/recorder.md)). Nothing here has to ask for it: the
offset is enough for the fold to tell a resend from an append, and the same arithmetic covers the
overlap between them. The rest of the card needed no such thing — `recording`, `seconds` and
`takes` are absolute in every frame, so the light and the two buttons come back on their own.

### …and the accumulation belongs to the STORE, not to the card

The half of this that was wrong at first, and the failure is worth stating because nothing in the
engine or in the fold was to blame. The resend arrives in **one frame**, about 50 ms after the
socket opens. The card that draws it does not exist yet — the graph has still to be fetched — and
`EngineStore` keeps only the LATEST frame. So a card folding frames itself always mounted after
the only frame that carried the picture, read a delta, and drew a take that looked like it had
just started. Every unit test passed: they hand the frame straight to `foldTake`, which is exactly
the consumer that was not there.

So `EngineStore.takeOf(node)` is what the card reads, and the store folds on `set`. Whoever asks,
whenever, gets the whole thing — which is also why this file is in `@studio/engine-browser` and
not next to the canvas: only something living as long as the CONNECTION can catch that frame.
`decimate` stayed behind in [ui-chains](../../ui-chains/src/decimate.ts), being about a width in
pixels rather than about a socket.

## Where the `live` archetype puts it

On the **master run**, between the sum and the interface:

```yaml
  MIX: [ rec ]
  rec: [ OUT ]
```

So a take is the whole mix, post-fader — what you would have heard. The same node between `IN`
and `fader` would capture one voice of it, before the level you set, which is almost never what a
rig's recording should be. See [liveProject.md](liveProject.md).

A module on the master run compiles onto `masterPlugins` rather than onto a track, keyed
`<chain>:<module>` — `MIX:rec`. That is the id the engine's ring is keyed by, and the reason
`populateMasterChain` now registers its plugins in `pluginsById`: without it the node is in the
document, in the graph, drawn on screen, and refuses to record.

## Getting one

The module ships with st0, in `packages/song/meta/audio/recorder/`, and a project names it
`@meta/audio/recorder` ([metaModules.md](metaModules.md)): a live rig is built on it, so no
library is allowed to be the thing that provides it.

Its `ui.yaml` comes with it, and that matters: a module with no face draws a card with nothing on
it, which is how the mixer's missing `ui.yaml` was found.

## What it does NOT do

- **It does not play back.** Its output is its input; what it captured is heard by saving it and
  opening it. A play button is a fourth control and a second rule for what comes out while idle.
- **It does not place a take on the timeline.** `recordTake` does that for transport takes and
  could be offered here later — a second destination for `save`, not a different feature.
- **It records stereo.** `RecorderTap::CHANNELS` is fixed at 2, for the reason `BroadcastTap`'s
  is ([recorder.md](../../../engine/st0-engine/docs/recorder.md)).
