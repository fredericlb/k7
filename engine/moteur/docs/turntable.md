# The platter — a deck that owns its audio

`TurntablePlugin` is a built-in that **produces** audio rather than processing it: it holds a
decoded record and reads it at a rate the desk drives, forwards, backwards or stopped.

It exists because the other answer was measured and refused. A deck is normally a clip on a
timeline, and moving one costs a re-insertion; driven at gesture rates that came out as a third of
a beat of error, worse the faster it was driven (`packages/ui-turntables/docs/scratch.md`).

## Rate, not position

The parameter is a **speed**, signed. That is what a hand imparts to a record, and it makes reverse
a sign rather than a mode. Position is its integral, kept by the plugin in fractional samples.

`Seek` is the other half — a normalised jump, applied only when the value **changes**, a parameter
being a level and not an event.

Three details are load-bearing:

- **The record is decoded WHOLE into memory.** A scratch reads backwards and jumps; a disk reader
  that seeks per block cannot follow it. The cost is real — a four-minute stereo song at 48 kHz is
  about 180 MB of float — and it is the price of the gesture.
- **Four-point Hermite interpolation.** Linear aliases audibly as soon as the rate leaves 1, which
  is the entire time during a scratch.
- **A one-pole glide of 6 ms toward the asked-for rate.** A hand's positions arrive at 60 Hz and the
  audio runs at 48 kHz; a rate stepped per message is a staircase and every step is a click.

The load takes a spin lock; the audio thread takes it with `tryEnter` and plays silence rather than
wait. Nothing on that thread opens a file.

A platter at rest is **silent**, not held: a needle frozen on one sample is a constant, and a
constant appearing and disappearing is a DC step on the bus. Below `stopRate` nothing is emitted and
the position does not move — which the 6 ms glide reaches about 55 ms after the rate is set to zero,
so the brake is still heard.

## KEY — the same platter, holding its pitch

`Key` is a fourth parameter, and with it a platter does what a varispeed cannot: change the tempo
and leave the pitch where it was. There are three regimes and only three:

| | |
|---|---|
| KEY on, forwards, `0.1 ≤ rate ≤ 4` | `TimeStretcher`, at ratio `1/rate` |
| KEY off | resampling — the pitch follows the speed, which is a record's own behaviour |
| backwards, stopped, or beyond the range | resampling, **always**: no algorithm stretches in reverse |

The third row is not a fallback, it is the point. **A scratch must change pitch** — that is the sound
of the gesture, and no turntable does otherwise. So the desk turns `Key` off for the duration of a
hand on the record and the platter resamples, exactly as before.

What makes this affordable is that the switch is **inside the plugin**. Switching representation —
clip ↔ platter — costs a document round trip, 85 ms measured, which kills a gesture. Stepping past a
stretcher costs a branch.

### Two things the implementation turns on

**Which algorithm.** `checkModeIsAvailable(elastiquePro)` is ASKED rather than named, because an
unlinked mode silently becomes `disabled`. On this build the answer is **SoundTouch**: it is the only
backend compiled in (`TRACKTION_ENABLE_TIMESTRETCH_SOUNDTOUCH`, `CMakeLists.txt`), Elastique and
RubberBand needing their own libraries. Everything measured below is SoundTouch's.

**Never leave a block half full.** A stretcher hands nothing back until it has primed — about 60 ms
of input for SoundTouch — so a drain loop that stops at the first empty answer produces a block with
a hole in it. Measured, that read as the *tempo being wrong by a factor of two*, which is a fine way
to spend an hour blaming the algorithm. The loop keeps feeding until the block is full, and only the
record running out ends it early.

### The needle must say what is HEARD

That priming is not a delay, it is a **read-ahead**: the plugin swallows 60 ms of record before the
first sample comes out, and the audio is not late. But `position_` is, permanently, and a cue is
dropped on that number.

So `owed_` tracks the record frames read and not yet handed back, and the published needle subtracts
it. Measured, with the platter started from a known point and the reported needle compared against
the wall clock:

| | the needle's lead over what is heard |
|---|---|
| resampling | 1.7 ms |
| KEY, read-ahead subtracted | **4.9 ms** |
| KEY, **without** the subtraction | *65.6 ms* |

### What KEY was measured to do

`engine/moteur/scripts/keylock.ts`. A tone alone cannot answer this — it has a pitch and no tempo, so
a stretcher would leave it untouched and the bench would pass by doing nothing. The source is
therefore a tone that is **chopped**: 1 kHz in bursts of 120 ms on, 80 ms off. One file, two
quantities, read apart — the carrier inside a burst is the pitch, the interval between bursts is the
tempo.

| | pitch | period | expected |
|---|---|---|---|
| KEY, 1.00 × | 1000 Hz | 197 ms | 1000 Hz / 200 ms |
| KEY, 1.16 × | **1000 Hz** | **168 ms** | 1000 Hz / 172 ms |
| KEY, 0.84 × | **1000 Hz** | **232 ms** | 1000 Hz / 238 ms |
| resampling, 1.16 × | *1160 Hz* | 169 ms | 1160 Hz / 172 ms |
| resampling, 0.84 × | *840 Hz* | 234 ms | 840 Hz / 238 ms |

The two columns move independently, which is the whole claim. The −1.5 % to −2.6 % on every period,
resampling included, is the bench's own floor and not the platter's.

**The period is read by autocorrelation, not by counting fronts.** A stretcher splices, so its output
dips mid-burst and every dip is a false onset; counting them reported half the true period and no
dependence on the rate at all. The resampled rows are what proved the bench rather than the engine
was at fault — they came out exact while KEY did not.

Two more readings, and both are nothing:

- **A jump leaves no hole.** The stretcher has to be emptied on a seek, and the longest silence in
  the second that follows is 81 ms in both modes — which is the 80 ms a burst is silent anyway. The
  measurement's floor is that same 80 ms: a shorter hole would hide inside it.
- **KEY adds no latency at the start.** From a standstill to the first sound: −6.5 ms resampling,
  −7.4 ms with KEY, spreads of about 8 ms. Only the difference is readable, the stream's origin
  leaning early and biasing both lines alike — and the difference is under the noise. It is the
  read-ahead above that pays, not the clock.

## What was measured

`engine/moteur/scripts/turntable.ts`, on a running engine. It drives the real plugin over
`set-plugin-param` at 60 Hz with a ±2× swing and reads the result off the broadcast tap.

**The source is not the clip bench's, and that is the method.** There, position was encoded as
FREQUENCY, which is readable only because `elastique` preserves pitch. A platter is a varispeed: it
moves the pitch WITH the speed. Turned round, that is the better instrument — a varispeed multiplies
frequency by exactly the rate, so a **constant tone is an exact tachometer**, and a scratch's
question is precisely whether the audio follows the hand's speed.

| | RMS error on the rate | worst |
|---|---|---|
| `--still` — a plain rate of 1, the floor | **0.000 ×** | 0.000 × |
| `--slow` — the same ±2 swing, eight times slower | **0.029 ×** | 0.912 × |
| the scratch — ±2, twice a second | **0.188 ×** | 0.942 × |

Read the three together rather than the last alone. **The error falls as the gesture slows**, by
about the factor the gesture was slowed. That is the signature of the 43 ms analysis window
averaging a rate that moves inside it — a property of the measurement, not of the platter. The clip
mechanism did the opposite: driving it faster made it worse, which is what a real limit looks like.

The commanded range comes out exactly (`-2.00 … 2.00 ×`), no window is silent, and the record ends
up behind where it started — so **reverse works**, which the clip mechanism could not do at all.

The worst case sits at the turnaround, where the rate passes through zero, the tone stops being
resolvable and any window straddling it reads an average of two speeds. Filtering on the asked-for
rate does not remove it, because the smear is in the audio and not in the command.

## How SOON it follows

Accuracy is one question and promptness is the other; a platter that lands in the right place a
quarter-second late is not a record. `engine/moteur/scripts/turntable-latency.ts` steps the rate at a
known moment and finds where the tone changed.

The tap carries its own buffering, so the stream's origin is estimated by keeping the LEAST DELAYED
frame of the run — the technique `@studio/engine-browser/playhead-clock` uses, for the same reason.

| | |
|---|---|
| fastest | 0.2 ms |
| median | **2.2 ms** |
| slowest | 5.0 ms |
| spread | 4.8 ms |
| one 256-frame block | **5.3 ms** |

**Read the shape, not the median.** A spread of one block with a median at half of it says the
message waits for the block boundary and for nothing else — not the socket, not the message queue,
not the 6 ms glide. A message lands uniformly inside a block, so it waits 0 to 5.3 ms and averages
half. That is the floor of the mechanism, and the engine adds nothing on top of it.

Two honesties. Ten of thirty steps are DROPPED: the origin leans early by construction, which pushes
some readings below zero, so this is a **floor rather than a mean**. And it excludes the audio
device's own output buffer — the tap sits before it, so add `2 × buffer / rate` for what a speaker
does (`docs/audioDevice.md`).

### What the bench cannot do

**Sign, per window.** It was tried: the record's amplitude ramps, so a rising level means forwards.
Over the interval a window compares, that envelope moves by 0.0006 — noise. The sign was a coin
toss and the error it produced was the bench's, not the platter's. So the tachometer reports
MAGNITUDE, and direction is checked in the large, over the whole gesture, where the envelope has
travelled far enough to say.

**And it cannot listen.** Everything above says the audio is where it was asked to be. Whether that
sounds like a scratch is a judgement no render makes.

## The needle is on the wire

A platter carries its own clock, so `playhead` says nothing about it. Every state frame therefore
carries `platters` — each platter's needle in seconds of its own record, keyed by plugin id.
`EngineHost::platterPositions` walks the session's plugins for it. A separated deck puts FOUR in
there, one per part; the desk reads the first, they sharing a position by construction.

The plugin publishes into an atomic **once a block**, not once a sample: the state push runs at
20 Hz, and an atomic store per sample would be waste on the one thread that must not waste.

Measured end to end — a platter at rate 1, watched for five seconds: 99 frames, the needle
0.002 → 4.943 s. It advances, and the engine says so.

## What a platter COSTS — measured

A record is held **16-bit and interleaved**: `4 min × 48 kHz × 2 ch × 2 bytes ≈ 44 MB`.

A deck that plays STEMS is **four** records, not five — the four parts play and the deck's own lane
is emptied, so nothing loads `master.wav`. Two separated decks are therefore eight platters:

| platters of 4 min | RSS delta | apply → first frame | *as float, before* |
|---|---|---|---|
| 1 | 72 MB | 245 ms | *111 MB · 267 ms* |
| 4 (one separated deck) | 199 MB | 313 ms | *374 MB · 330 ms* |
| 8 (two separated decks) | **375 MB** | **399 ms** | *723 MB · 441 ms* |

### Why 16-bit is faster and not just smaller

It is not, if you write it the obvious way. Decoding to float and packing down afterwards halves the
bytes and makes the apply **worse** — 667 ms at eight platters, against 441 as float — because the
float pass is still paid and a conversion is added on top. That was measured before this was.

The win comes from removing the float entirely. A record off the médiathèque is an INTEGER file, so
`AudioFormatReader::read` into int is the reader's own format: no conversion, anywhere. JUCE
normalises such a read to the top of int32, so the sample is the top 16 bits and packing is a shift.
Read in blocks through a small scratch rather than into two full-length int32 vectors, and both
columns fall.

A FLOAT wav keeps the old path, and has to: it may sit above 1, so the peak must be known before
anything is packed. It is scaled DOWN only, so a quiet record keeps its level, and the scale rides on
the gain at playback — one multiply for both.

**A stem is NOT one of those.** `wavPcm24` and ffmpeg's `pcm_s24le` both write 24-bit integer
(`packages/ui-turntables/docs/stems.md`), so the four parts take the direct read like any other
record. It is worth saying because it is worth 89 ms: a bench that wrote the stems as float measured
192 ms to put a separated record on, against 102 for the same thing in 24-bit.

What 16 bits costs is 96 dB of range on a signal that is played, not delivered. The stems' own
summing sits at −34 dB (`packages/ui-turntables/docs/stems.md`), nowhere near it.

### A separated deck is FOUR platters, and what that costs

It used to stay on clips, decided on a number that was read wrong: 441 ms against 267 was an apply
**cold, on an empty engine** — the page loading, once. The gesture that matters is putting a record
on a deck that already holds one, and `packages/ui-turntables/scripts/put-on.ts` measures exactly
that, by timing the `applied` reply to the document `withDecks` produces:

| record | one platter | four platters | difference |
|---|---|---|---|
| 2 minutes | 21 ms | 102 ms | **+81 ms** |
| 4 minutes | 42 ms | 200 ms | **+157 ms** |

It scales with the length, because what it is doing is reading four files instead of one. At a real
song's length a separated record takes **a fifth of a second** to land — over the ~100 ms where a
gesture starts to feel like a jolt, and worth knowing. It is paid on the deck being LOADED, which is
by definition not the one playing.

What it buys is that everything else stops being two things: one position model, one implementation
of every gesture, and a separated record that scratches like any other.

**And it is not a CPU problem.** Eight platters — both decks separated, both turning — cost about
30 % of one core, and turning KEY on for all eight adds **3 points**, four SoundTouch instances per
deck included: `put-on.ts --hold=45 [--key]`, with `Get-Process studio-moteur | Select CPU` read at
each end of the hold.

The one real cost is the one `bpm.md` already names: four parts stretched separately sum back less
exactly than four resampled ones, because a pitch-preserving stretch is not linear. That was true of
the clips too, and it is why KEY is off by default.

## The desk drives it

**Every deck plays through platters, and nothing plays off a clip any more.** A separated record is
four of them rather than one, and `plattersOf(deck, load)` is what a gesture reaches: `place` seeks
all four, `scratch` drives all four, and the needle is read off the first, they sharing a position by
construction. There is one position model left, and one implementation of every gesture.

The desk owns one rule the engine cannot: **a hand on the record turns `Key` off**, and lets go of it
on release. `platterKey(tempo, holding)` is that rule, written once and read by the document as much
as by the gesture — a document being what the deck does when nobody is touching it. It reaches the
engine as a parameter and not as a re-send, twice per gesture rather than sixty times a second.

### The pitch fader ran BACKWARDS on a platter

`platterRate` returned `natural / target`, which is the STRETCH — what a clip's warp wants. A rate is
its inverse. So a song of 120 asked to play at 140 was handed 0.86 and slowed down, on the desk's
default path, with the fader moving the record the wrong way.

The clip path was right throughout, which is what settled it: its warp laid 60 s of a 120 song asked
for 60 across 120 s of timeline — half speed — so the rate at that setting is 0.5 and not 2. The test
that covered this asserted 2, and its own comment said "half the tempo is half the speed".

Both are now pinned, the value AND the direction: asking for more tempo must return more than 1.

Three things follow from a deck carrying its own position, and they are all the same fact:

- **Each deck starts alone.** `Rate` is per deck, so deck B rolls while deck A is stopped — the thing
  a single transport forbade. Only an EMPTY deck has no button: there is nothing to start.
- **Any record can be scratched**, separated or not. `packages/ui-turntables/docs/scratch.md`.
- **The transport is no longer a deck's clock**, and no longer anything's: `needle(deck)` is, and it
  is the only position reader there is.

One wart worth knowing: a parameter is a LEVEL and carries no events, so asking twice for the same
`Seek` — pressing cue 1 twice — would jump once. The desk alternates the value by a billionth of a
record, which is under one sample at any length.

## Where this stands

The plugin, the wire, the loading, the diff identity, the desk driving it, the per-deck transport,
the scratch, KEY and the separated record are done: **the clip path is gone**. What is not:

- **The metronome is still a clip on the transport**, which no deck follows any longer. It was
  already so before any of this, and it is a separate question — `packages/ui-turntables/docs/metronome.md`.
  Step 4 of `docs/platter-plan.md` deleted the dead clip code around it and left the click with its
  SPACING and no phase, which is what it had already, said out loud.
- **Nothing has LISTENED.** Everything above says the audio is where and when it was asked for.
  Whether that feels like a record under a hand is a judgement no render makes.
