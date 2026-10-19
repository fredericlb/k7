# A deck's tempo, and the sync

A vertical fader beside each record, two SYNC buttons at the ends of the bottom bar. The button
says **who leads**: pressing the left one puts both records on the left fader's tempo, and the
right fader greys out and moves by itself.

## The fader is a MODULE's parameter

Not a control the desk invents: the project says so. `example.k7` puts on each deck a node of the
médiathèque's `@k7-core/cold/tempo` module, and the fader is that node's `Target BPM`. One
node per deck, because each deck plays at its own BPM and a parameter belongs to a **use**, not to
a module.

That module is **cold**, `plugin: {type: offline}`: it compiles into no engine plugin. What it
brings is the DECLARATION that this deck has a tempo — which is what lets a desk control name it.
See `packages/song/docs/coldModules.md`.

Concretely: the binding gives not a `pluginId` (there is none) but the **track** whose material the
module treats, and it is that track's platter that changes speed. Re-point `deckA.tempo` at `tempoB`
and it is deck B that stretches under the left-hand fader.

## How a song changes tempo

The document carries **one** tempo and it is fixed (`DOC_TEMPO`, 120) — but no deck reads it: each
is a **platter** owning its record and reading it at its own speed.

```
Rate = target / natural
```

That is all. `platterRate` writes that number, the plugin turns it into a sample step per output
sample, and `Key` decides whether a stretcher holds pitch meanwhile
(`engine/k7-runtime/docs/turntable.md`). A platter has nothing to place: it is where it is.

## KEY — pitch follows tempo unless stopped

The button under the fader is a CDJ's **MASTER TEMPO**, the **Keylock** of Traktor, Serato and
rekordbox. It is **off by default**, as on the hardware: a deck's pitch fader does what a Technics'
belt did — the song goes faster AND rises in pitch. Holding the key is the extra gesture, not the
other way round.

KEY is **a plugin parameter**, `Key`, and nothing else changes: same platter, same position, same
gestures. The engine puts its stretcher in the path or takes it out, internally, at the cost of one
branch (`engine/k7-runtime/docs/turntable.md`).

A separated record is no exception: its four parts are four platters, each with its stretcher.
Measured, the eight of a full desk cost **3 points of CPU** — the price is not there.

**The default is not just taste.** A constant-pitch stretcher is non-linear: it picks its frames
from the signal, so four parts stretched separately no longer sum as the record would. That is what
broke the subtracting version of `stemcut` (`packages/song-schema/docs/stems.md`), and it stays true
of the sum, more discreetly: with keylock on, the four parts glue back together less well.
Resampling is linear — the same combination of samples for all four files — and costs nothing on
that side.

Many DJs leave the button off for small offsets: at ±3 % the pitch shift is less audible than the
stretching artefacts.

**It is a setting of the DECK, not of the record.** It survives the song you put on, where
`clearTempo` wipes the tempo at every load — hence `withKeylock`, which merges it into the
`DeckTempo` rather than storing it there. Changing it is a DOCUMENT change, so it re-sends the
project, like a released fader.

## The range is the module's knob's

The module declares its panel: a **BPM knob from 10 to 300**, plus a display of the measured tempo,
in `ui.k7x`. The Mix fader **is** that knob, so its range is that one. A surface offering less
would silently refuse values the module accepts; one offering more would send values the panel
cannot draw.

That is wide — 290 BPM over a screen height, so a coarse drag. Three things catch it: the detent at
the song's tempo, the 0.1 step, and the double-click that returns to it.

A real deck's **±16 %** survives only as a warning threshold: the percentage under the fader turns
**amber** beyond it. That happens quickly — matching a 90 BPM song to a 123 BPM one is a **+37 %**
stretch, legitimate and audible. Better seen than discovered in the speakers. And the sync bounds
nothing: "synchronised" means the same tempo, and clamping would leave the two decks at different
BPMs while the button claimed otherwise.

## Taking the fader back cancels the sync

The slave's fader is **greyed but grabbable**. Greying says "not yours right now", not "not
allowed": on every machine with a SYNC button, grabbing the slaved deck's pitch is *the* way out. A
knob that refused the hand would force a second trip back to the button.

So moving the slave fader sets `master` to `null` and that deck carries on from where the knob was
— that is, from the **synchronised** value, not the one it had before. That is the detail that
matters: clearing `master` first and reading the value after would jump the song to its old tempo
on the first pixel.

Moving the **master**'s fader breaks nothing: both follow, which is what leading means.

A deck with no detected tempo leads nothing and follows nothing — there is no number to
synchronise to, and inventing one would be the confident lie avoided everywhere here. Both buttons
are disabled until both decks have a tempo.

## Moving the tempo does not move the MUSIC

That is what a deck does without thinking: you change the platter's speed, the needle stays in its
groove. `TurntablePlugin` keeps its position in a field of its own and only touches it on `Seek`;
`Rate` only changes the step. Writing a new tempo therefore cannot move the record — not because
it is caught up, but because nothing pushes it.

## During the drag, but not on every pixel

The crossfade moves on every pixel because it is a **plugin parameter**: `set-plugin-param`, one
message. A tempo travels in the **document** — `platterRate` writes the `Rate` of the deck's
platters, and a separated record has four.

So the document goes out **throttled**: at most once per `LIVE_WARP_MS` (120 ms), always with the
latest value. The tempo follows the hand instead of arriving at the end.

And not only throttled: **thresholded in value** too. Below `LIVE_WARP_BPM` (0.05 BPM — four
hundredths of a per cent at 120, less than one cent of pitch) nothing goes. What that catches is
the end of a careful drag, when the hand advances by tenths and would otherwise ask for eight sends
a second to say nothing. Release is exempt: the value you let go of must be true, however small the
last movement was.

Those two numbers are **conservative rather than justified**: they have not been measured against a
`Rate`, which is cheap.

It is a *throttle*, deliberately not a *debounce*: a debounce cancels its deadline on each new
value, so a continuous drag would send nothing until the hand stopped — exactly what must not
happen here. A deadline already set is therefore left alone and reads the current value when it
fires. Release additionally sends the exact value: the last throttled tick can be 120 ms of gesture
away from it.

## What to know before trying it

The tempo comes from the `{file}.cache` sidecar, that is from the **same analysis** as the
waveform. On this machine, **4 songs out of 279** have one. For all the others, loading the song
would trigger analysis by the engine — several seconds — during which the fader would read `—` and
the sync would be disabled.

So the desk walks the playlist the surface names, one song at a time, as soon as it has its list.
See [prewarm.md](prewarm.md). Analysing on load is fine at a desk and fatal on stage — the second
you put a record on is the second you have not got five seconds.

And when the analysis is wrong, it is correctable: [grid.md](grid.md).

## The node in the graph shows both numbers

The desk is not the only screen where this tempo is read: the module's **node** is right below, in
the graph, with its `Target BPM` knob and its `Source BPM` display. Since the module is `offline`
it compiles into no plugin — the engine has nothing to report and no address to report it at. The
value exists only on the surface that **realises** it, and `useDeckSet` lends it to the graph
through `deck.setModuleParam`.

Three things are needed for that, and without any one of them the node stays frozen on what
`project.k7x` declares — which reads exactly as "the BPM does not update when a song is loaded":

| | what is needed |
|---|---|
| the host | k7 passes `moduleParams` **and** `onModuleParam` to `DomChains`: those two are what **switch these widgets on**. Without them the graph draws `–`, inert. |
| `Source BPM` | `views/mix.k7x` binds one parameter per control, so only `Target BPM` is named there; the other is measured and has no writer in the file. The publication below is what writes it, or the display stays at 0 for every song. |
| the gap | putting a record on **clears** the fader (`clearTempo`) and the measurement arrives a moment later. Skipping the publication during that gap leaves the node on the **outgoing** song's numbers — at the exact moment you are looking at it to see what you have just put on. |

The last two rules live in `offlinePublish` (`mixBindings.ts`), beside the other reads of the same
file, so a test holds them. A deck with no tempo publishes **0**, which is the module's own
"change nothing" — and not silence.

`offlinePublish` answers only for **tempo** controls: its list is derived from the tempos and holds
nothing else. A broader rule — "any binding with no plugin", publishing the deck's target — would
make an `offline` module bound to something else, a stem cut, read its deck's BPM as its own value.

The widget stays **read-only** in the graph: `moduleParams` lights the display, `onModuleParam`
alone would make the knob actionable, and the return path does not exist yet — `fromGraph`, here,
has no caller. Read-only is honest; turnable-and-ignored is not.

## The sync also aligns the beats

Two decks at 128 BPM whose downbeats are 200 ms apart are not synchronised, they *flam*. So the
sync does **two** things: give the slave its tempo, then align its grid on the master's.

Aligning the phase needs no per-deck transport: the **transport** is never moved. What moves is the
slave's **position** — `alignSeek`, which reads where both actually are. One case only: everything
plays through a platter, separated record included, and a separated record is four platters one
seek reaches.

A platter is pulled backwards as readily as forwards, so `alignSeek` takes **the shortest path** —
never more than half a beat.

Two things to know how to measure for that:

- **Where the grid starts.** `beats.ts` takes a **circular mean** of it: every transient is folded
  onto one beat period and becomes an angle, and the unit vectors are averaged. What lands on the
  beat adds up, the rest cancels. The length of the result says how much the attacks agree, which
  is what allows refusing to answer rather than inventing a phase out of noise. And not
  `transients[0]`: one attack is one measurement, and a click in a quiet intro would move the whole
  grid — including the waveform's yellow lines, which read the same number.
- **Where it is HEARD.** A source second `s` is played at `s · natural / target`: a 90 BPM song
  stretched to 120 arrives a third earlier. Taking the file's phase instead of the deck's would
  shift the downbeat by 100 ms — an audible flam.

Both decks are at the same `target` by the time the question arises (that is what the sync did
first), so their periods already coincide and only the offsets differ. The answer is their
difference, folded into half a beat either side.

### Knowing when to keep quiet, and saying so

The least obvious decision of the lot, and it is measured. A phase is published only if the attacks
really said one; otherwise the deck gets the **tempo** and no offset. Matching the speed is worth
it on its own, and an invented phase would move the record for nothing.

Raw strength cannot decide alone, because what counts as "high" depends on the number of attacks:
scattering `n` of them at random still leaves a resultant of about `0.886/√n` — 0.04 for 400
attacks, 0.09 for 100. A fixed threshold would therefore classify songs by their **length**. The
**Rayleigh** test is that comparison done properly: `n·R²` against 4.6, that is p ≈ 0.01 against
"the attacks are uniformly spread, there is no grid".

On the three songs of `example.k7` it separates cleanly rather than hedging:

| song | bpm | attacks | strength | `n·R²` | grid |
|---|---|---|---|---|---|
| Daft Punk — Around the world | 121.36 | 404 | 0.591 | **141** | yes |
| Stromae x Pomme — Ma meilleure ennemie | 87.93 | 236 | 0.268 | **17** | yes |
| Alain Bashung — La nuit je mens | 123.31 | 292 | 0.027 | **0.2** | no |

The last row is *below* chance level: the detected tempo is simply wrong, and that is exactly the
case that must not move a record. The SYNC button stays active — half the sync is worth having —
and its tooltip says which half it will do.
