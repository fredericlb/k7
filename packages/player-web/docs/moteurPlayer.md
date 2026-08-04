# The moteur-backed player

`player.ts` has said this was coming since étape 2:

> It is the seam a third engine arrives through: an implementation backed by
> `engine/moteur`, once the engine can stream to a browser at all.

Étape 7 made that true, so here it is. The interface did not change to accommodate it —
which is the point of having had a seam.

## What it is for, and what it is not

This is **not** a replacement for `SongPreloader`. The Web Audio path is simpler, needs no
engine, and has milliseconds of latency where this has a whole process and a cushion. For a
laptop running a blind test at a table, the browser player remains the right one.

This is for the case the plan describes: z0 on a machine that also has a moteur. Three
things it buys, and they are the only reasons to pay for it:

* **Real DSP.** `audioEffects.ts` hand-rolls its chain from `BiquadFilter`s and — for the
  bitcrusher — a `ScriptProcessorNode`, which is deprecated API running on the main thread.
  The engine has Tracktion's built-ins and 186 AirWindows effects, in a real audio thread.
* **Files, not fetches.** The engine opens a path. No decoding a whole song into an
  `AudioBuffer` before a round can start.
* **It comes out of the interface.** The PA hears it, not just the tab. That is what
  "le moteur traite et **diffuse**" was about.

## The effect mapping, and the two that do not map

Seven of z0's nine sliders have an engine equivalent:

| slider | engine plugin | why that one |
|---|---|---|
| `lowpass` | AirWindows **Lowpass** | a real filter, swept on one 0..1 control |
| `highpass` | AirWindows **Highpass** | same shape, other direction |
| `phaser` | Tracktion built-in `phaser` | its `depth` is the sweep's octave span |
| `chorus` | Tracktion built-in `chorus` | `depthMs` over a fixed 20 ms base delay |
| `overdrive` | AirWindows **Density** | saturation is what AirWindows offers for drive |
| `bitreduction` | AirWindows **De Rez** | bit and sample-rate reduction |
| `pitchvar` | AirWindows **Vibrato** | wobble as modulation rather than a detune LFO |

The two built-ins take their `xmlTypeName`; the AirWindows ones take the display name
Tracktion registers (`AirWindowsList.h`). Both vocabularies coexist on the wire — that is
what `enginePlugin` is about. Their parameter ranges come from
`engine/moteur/docs/builtinParams.md`, which exists because those plugins publish none.

**`speed` and `pitch` do not map, and are refused.**

They are not effects. They are properties of how a clip is *read*, and `ClipDoc` has no
field for either. Its `warp` carries stretch **markers** — a mapping of timeline beats onto
source seconds — so expressing "play at 1.4×" through it would mean synthesising markers
across the whole file and trusting the stretch algorithm to agree. That is a feature the
engine would have to grow; it is not something this mapping can fake.

### Why refusing loudly is the whole design

Approximating them was the tempting thing. In a blind test it is the wrong one:

> A difficulty effect that silently does nothing means the players heard an easier song
> than the round claimed — and nobody finds out, because clean audio sounds correct.

So `PreloaderState` grew one optional field, `unsupported: string[]`, which the game's UI
already subscribes to. Optional, so `SongPreloader` — which can do all nine — never sets it
and still satisfies the type. Not a throw, because a game must not crash mid-round.

The same reasoning drives two outright rejections:

* **`playReversed` rejects.** The engine has no reverse; the browser does it by building a
  reversed `AudioBuffer`, which has no analogue in a document read from a file. A reversed
  round played forwards is one every player answers instantly.
* **More decks than there are is rejected**, not truncated. A stem that never sounds is a
  wrong answer nobody can trace.

### One more thing that is NOT a bug

The same slider sounds **different** on the two engines. A browser lowpass is one
`BiquadFilter`; AirWindows' Lowpass is a filter somebody voiced. So a saved effect preset is
not portable between them, and a game offering both must not pretend it is.

## Paths: the reason this came last

`resolvePath` is required and has no default. z0's song paths are URLs its own backend
serves; the engine opens files. There is no honest guess between the two.

In practice it resolves through the médiathèque's local cache — which is exactly why the
plan put this leaf last: it needs *"un moteur local sur une machine qui n'a aujourd'hui
besoin que d'un navigateur"*. Returning `null` means "this machine does not have that song",
and the player reports it in `failedPaths` **before the round starts** rather than sending
the engine a path it warns about once and then plays silence for.

## Shape notes

* **There is no preload.** Applying a `ProjectDoc` *is* the load — the engine opens the file
  and instantiates the chain when the document arrives. `preloadSong` therefore only checks
  what this machine can resolve.
* **A slider move re-sends the document, not the song.** The engine diffs, so the chain
  rebuilds under a running transport. That is why `setEffects` sends and does not `play`.
* **`isPlaying` comes from the engine's state frame**, never from a flag set hopefully when
  a play was sent. A document that failed to load leaves the transport stopped, and the UI
  has to show that rather than a spinner.
* **`resumeContext` does nothing.** The audio context is the engine's, and it was open
  before the page was.

## Not done

* **Nothing wires it in yet.** z0 still constructs `SongPreloader`; choosing between
  the two engines is a decision for the game's own settings, and it needs somewhere to put
  `resolvePath`.
* **Never run against a real engine.** The 23 tests drive a fake `EngineClient` and check
  what was *sent*. Whether AirWindows' "Lowpass" is the name `createNewPlugin` resolves, and
  whether `Density` is really the parameter name, are exactly the claims a fake cannot test.
  The names come from `AirWindowsList.h` and `builtinParams.md`; the wire is unproven.
* **Listening in the browser is the caller's to wire.** This drives the engine; the
  étape-7 broadcast (`EngineClient.broadcast`, `@studio/engine-browser/stream`) is a
  separate opt-in, because a presenter with a PA does not want it.
