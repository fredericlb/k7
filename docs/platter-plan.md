# The platter stretches for itself

The decisions of the platter work, in one place. Current behaviour is described by the ordinary
pages — `../engine/st0-engine/docs/turntable.md`, `../packages/st0-plugins/docs/turntables/scratch.md`.

## Everything plays through a platter

A deck plays through a **platter** (`TurntablePlugin`) that owns its record and reads it at a
position it carries itself. Scratch, per-deck start, and cue points that do not move the other
deck all fall out of that for free. **Nothing plays through a clip**: there is one position model
and one implementation of each gesture.

Two models would mean two implementations of cue, scrub, nudge and sync, and a predicate deciding
between them that the document and the desk must apply identically — applying it more narrowly on
one side gives a frozen waveform with sound in it.

## The stretcher lives inside the platter

`tracktion::engine::TimeStretcher` is in the plugin, so the choice is internal and therefore
instant:

```
playing, KEY on    -> the stretcher, ratio natural/target: the pitch holds
playing, KEY off   -> resampling
SCRATCH            -> resampling ALWAYS, stretcher bypassed
```

The third line is not a compromise: **a scratch must change pitch**, that is the sound of the
gesture, and no turntable does otherwise. Switching representation (clip ↔ platter) cost a
document resend — 85 ms measured — which kills a gesture; bypassing a stretcher costs nothing.

Facts worth keeping:

- **The backend is SoundTouch**, not Elastique: it is the only one compiled here
  (`TRACKTION_ENABLE_TIMESTRETCH_SOUNDTOUCH`), the others wanting their own libraries.
  `checkModeIsAvailable` is therefore INTERROGATED rather than named.
- **A jump makes no hole.** 81 ms of silence after a `Seek` in both modes, i.e. the 80 ms a burst
  is silent for anyway.
- **The stretcher delays nothing, it reads AHEAD**: it swallows 60 ms of record before rendering
  its first sample. Audio is not late, but the reported needle was — 65.6 ms, and a cue point is
  dropped on that number. The platter subtracts the lead-in; 4.9 ms remain, against 1.7 when
  resampling.
- Bench lesson not to lose: **a burst's period is read by autocorrelation, not by counting
  edges.** A stretcher splices, so its output dips mid-burst and every dip is a false edge —
  reporting half the period and no dependence on rate.

The measurements are `engine/st0-engine/scripts/keylock.ts`, the numbers in
`../engine/st0-engine/docs/turntable.md`: pitch holds at 1000 Hz while the period follows the rate;
resampling moves both.

## The desk turns `Key` on, and off while a hand holds the record

The rule is written once, `platterKey(tempo, holding)`, and read by the document and by the
gesture alike. The join stretched → varispeed needs no special handling: the engine already falls
back to resampling outside the stretcher's range, so the desk and the plugin say the same thing
by two routes, and an internal switch changes neither the position nor the record. Whether the
join is inaudible is a judgement no bench renders — it has to be listened to.

A rate is `target / natural`, not `natural / target`. The inverse is the STRETCH a clip's warp
wants; used as a rate, a song at 120 pushed to 140 gets 0.86 and **slows down** — a platter's
pitch fader running backwards.

## A separated record is four platters

The four parts share a position, a rate and a `Key`; `plattersOf(deck, load)` names them, and
`place`, `scratch` and the needle all go through that list.

The cost is loading, measured by `packages/st0-plugins/scripts/turntables/put-on.ts`, which times the
`applied` response:

| putting a record on a deck that already holds one | plain | separated | overhead |
|---|---|---|---|
| 2 minutes | 21 ms | 102 ms | **+81 ms** |
| 4 minutes | 42 ms | 200 ms | **+157 ms** |

It follows length, so at a real song's length it is a fifth of a second, beyond the ~100 ms where
a gesture feels like a jolt. It is paid on the deck being LOADED, which by definition is not the
one playing.

Two things that are not costs:

- **CPU is not one.** Eight platters cost ~30 % of a core, and turning KEY on for all eight —
  eight stretchers — adds **3 points**.
- **Stems are not float files.** `wavPcm24` writes 24-bit INTEGER, so the four parts go through
  the engine's direct read. Writing them as float measures 192 ms instead of 102, which is what
  the difference is worth.

A non-linear stretch also argues for it: four parts stretched separately reassemble less well,
while resampling is linear. **A varispeed scratch on stems is therefore truer than a keylocked
tempo on stems.**

## Changing tempo cannot move the record

Checked rather than assumed, because it is the whole argument for having dropped the correction
machinery: `TurntablePlugin` keeps its position in a field of its own and touches it only on
`Seek`; `Rate` enters only into the step. Nothing pushes the record, so nothing has to catch it.

Gone with the clip path: `slipToPlace`, `slipAfter`, `startSeconds`, `clipStartBeats`, `warpFor`,
`TIMELINE_BASE`, `playFrom`, `transportAt`, `sourceAt`, `alignDelay`, the `slip` and `align`
fields of a `DeckTempo`, and `KEYLOCK_ALGORITHM` / `VARISPEED_ALGORITHM`. `nudgedTempos` only
sets a target; `syncedTempos` only hands it to the slave, `alignSeek` handling the times. The
transport starts from zero, on the desk as in st0. Of the four benches only `put-on.ts` still
asks a question with an answer; the numbers of the others survive where they still decide
something — `docs/bpm.md`, `docs/metronome.md`, and a whole section of `docs/scratch.md` for
scratch-by-clip, which is what paid for the platter.

## What is still open

The **metronome**. Its clip is the transport's last inhabitant; it has the right spacing between
beats and an arbitrary offset against the music. It starts at zero, and
`../packages/st0-plugins/docs/turntables/metronome.md` says the phase is missing rather than simulating it.
The two candidate remedies — one more platter, or an anchor computed off the needle — are written
there; neither is decided and neither has been listened to.
