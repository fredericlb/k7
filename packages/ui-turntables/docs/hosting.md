# What a host owes the desk

Two turntables meeting at a crossfade, their channel strips, the waveforms, the cues and the
set list. l8 draws it as a `surfaces/` view (`packages/song/docs/surfaces.md`).

## The seam is the ENGINE, and only the engine

`./engine` declares `Deck`: a phase, a transport, a client, the live plugin values, and the two
calls that watch and publish them. **Nothing in it names a host.** The registry, the session id,
the service prefix and the lease are how a host *obtains* an engine, and none of that is in the
type — which is what keeps the desk independent of the app around it.

So a host supplies a `Deck` and the desk asks nothing else. l8 does it with an adapter over the
link its shell already holds, since it has an engine before it has a surface
(`apps/l8/frontend/src/hooks/useTurntableDeck.ts`).

### The transport is TWO readers, and a host owes both

`Deck` asks for the position twice, and the split is not redundancy — the two callers want
opposite things:

| field | shape | for |
|---|---|---|
| `playhead` | a ref, `{ seconds, at }` — the raw anchor and when it landed | numbers that get **written down**: a cue drop stores where the finger fell |
| `drawNow` | `() => number`, steered | numbers that get **looked at**: the record's wedge and the waveform, redrawn at 60 fps |

The engine speaks every 50 ms and not on a regular beat. Extrapolating from the raw anchor is
right for a timestamp — nothing is traded away — and wrong for a redraw, because re-anchoring on
every frame copies the arrival jitter into the picture: 60 fps of stutter instead of 20.
`drawNow` runs a local clock and lets the engine bend its **rate** by at most ±10%, snapping
only on a real seek.

So it is deliberately **not** the most accurate answer, and a host must not implement one by
calling the other. `@studio/engine-browser/playhead-clock` is the clock; l8's adapter feeds it
the same frames it writes into the ref, a few lines apart. The same distinction exists on l8's
own timeline, where `useMidiRecording`'s `beatNow()` stays raw for exactly this reason —
`apps/l8/frontend/docs/playhead.md` argues it once for both.

### `sendProject` is part of the seam, and it is not optional

The desk plays by handing over a whole `ProjectDoc`. **Who is allowed to hand one to an engine is
the host's answer, not the desk's**: l8's file service loads l8's project itself and is the only
writer to that engine. So `sendDecks` takes `Deck.sendProject` rather than an `EngineClient`, and
l8 posts to its service.

Getting this wrong is not subtle and it is not loud either: two writers push documents that are
each correct, and the last one wins. See `packages/song/docs/surfaces.md` for the ordering rule
the file service owns.

`engine` stays on the seam for everything that is NOT a document — the transport, a seek, a param.
Those are messages about what is already loaded, and no host has a second writer for them.

Everything else the desk needs is already shared and is imported directly rather than injected:
the file routes are `@studio/project-shell`'s `projectApi`, the catalogue types are
`@studio/mediatek`'s, and `songs.yaml` is `@studio/song`'s. A seam over those would be a seam
over something that is already one thing.

## What is NOT in here

`useEngine` itself, and the gate that picks an engine. Those are the app's — a package that
chose a machine would be choosing it for every host.

Nor an editor or a graph view. A file tree and an editor are `@studio/ui-editor`'s job, not a
desk's, and the chains graph is `@studio/ui-chains-react`'s. What the graph needs FROM here —
`M9_ICONS` and `deckGraph` — lives here because those describe *decks*.

## The set list is a FILE, and that is what makes l8 able to host it

`songs.yaml` at the project root, read through `@studio/song/yaml/songsFile`. Nothing about it
is desk-shaped: it names médiathèque songs, and any project that carries one has a set. That is
why bringing the desk to l8 did not require inventing a set-list concept for l8 — an `.l8`
folder with a `songs.yaml` beside its `surfaces/` is a set, in the same words.

## What one deck costs

`DECKS` is a list, not a pair. A third deck is a third track and a second meeting point in the
chains file; nothing here hardcodes two, and `controls.ts` derives the desk's controls from that
list precisely so adding one does not silently leave it unbindable.

## Verified how

`npm run test --workspace @studio/ui-turntables` — pure logic: the deck document, the cue and
slip maths, the beat grid, the bindings join, the set list, the waveform buckets. **Nothing
mounts.**

**One failure mode here is a SOUND**, and `scripts/` holds the two harnesses for it. Both point
at a running engine and drive the real `deckDoc` and `nudgedTempos`, so they measure what ships:

- `tempo-drag.ts` — does moving the BPM fader move the MUSIC? It plays a source whose frequency
  encodes its own position and reads the tone back off the broadcast tap, so a skip shows up as
  a step in that number. `--raw` drops the slip correction, to measure the fader without it.
- `metronome.ts` — does the click land ON the deck's beat? The deck plays a SILENT file, so
  everything the tap hears is the click.

```
npx tsx packages/ui-turntables/scripts/tempo-drag.ts [ws://127.0.0.1:8765] [--raw]
npx tsx packages/ui-turntables/scripts/metronome.ts  [ws://127.0.0.1:8765]
```

They live here rather than in a host, beside the maths they exercise and the pages that explain
it (`docs/bpm.md`, `docs/metronome.md`).
