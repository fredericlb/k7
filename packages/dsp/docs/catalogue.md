# The modules written with this library, and why each is what it is

**This repo ships no modules.** A module is `module.yaml`, a panel, and the `jsdsp.ts` or `dsp.dsp`
that makes the sound, and all of that is authored straight into the account's **library
repository** — `@studio/song`'s `docs/sharedFolders.md` gives the reason: the library is the
reference, and a copy in a build would be a second source of truth quietly disagreeing with it.

What is here instead is the *reasoning*, for the modules that were designed against this library
and whose numbers are argued rather than picked. The graphs themselves live in `../src` as
functions — `echo()`, `autoWah()`, `tremolo()`, `noteRepeat()`, `normalize()`, `crossfade()`,
`fade()`, `sweep()` — each with a test holding it to the shape a module's copy of it must have.
That is what makes a module in somebody's library checkable at all from this side.

A module's path in a library is `<type folder>/<category>/<name>`. The first segment decides what
the module IS (`audio`, `instruments`, `transformers`, `io`… — see `@studio/song`'s
`docs/loader.md`); the second decides only where it sits in a picker, which is why an EQ is filed
under `filter` and not under `utility` though both are audio.

The modules discussed below: `eq3`, `sweep`, `moogladder`, `crossfade`, `fade`, `tempo`,
`normalize`, `tremolo`, `stemsplit`, `quick-master`, `wurlitzer`, `arpeggiator`, `note-repeat`.

`quick-master` makes no sound of its own: no `jsdsp.ts`, no `dsp.dsp`, only an
`extends: "@engine/quick-master"` and defaults over it, the way `eq3` sits on the engine's
equaliser. What it names is a compiled built-in, and `engine/st0-engine/docs/quickMaster.md` says why
it could not be a graph: `DspGraph`'s primitives can neither split bands nor reach the difference
between the two channels.

`tremolo` is the plainest graph of the lot: an LFO, an offset, a multiplication. It is argued here
because it is the one effect whose obvious cheap
implementation is wrong — a gain stepped once per block is a ~10 ms staircase, which on a tremolo
is not a smoothed version of the effect but a different one, heard as a stutter. `lfo()` runs at
sample rate for that reason (`docs/builder.md`), and this module is what that decision is for.
Its `Depth` at 0 is exact unity, so it can be left in a chain switched off.

`transformers/notes/` holds the two note modules, and the pair is worth reading together because
they answer the same question differently.

`note-repeat` is a **graph**, three lines of this library: it is a note SOURCE with a clock, which
is exactly the thing a MIDI graph was long said not to be able to be. The MIDI phase has two nodes
with state — `mhold` takes the keys, `mstrike` plays them on a clock — and they are what a rhythmic
MIDI module is made of. `engine/st0-engine/docs/midiGraph.md` argues the whole of it. Its rate is a
PAIR, `Count` divisions rather than one, and `Division` is written in BEATS rather than as an
index: the panel's dropdown writes the value it labels, so the eight divisions are named in exactly
one place.

`arpeggiator` is still compiled — `extends: "@engine/arpeggiator"` and three defaults over a
built-in, the second after `quick-master` that makes no sound of its own.
What it needs that the two nodes do not give is the WALK: an arpeggiator strikes one slot per step,
chosen by a direction and a number of octaves, where `mstrike` takes the whole held set. That is a
third node and not a mode flag, and `engine/st0-engine/docs/arpeggiator.md` says where it goes. Its
panel is three dropdowns rather than three knobs: a cadence has nothing between 1/8 and 1/8T.

The two stay separate modules rather than becoming one with a `Pattern: chord|walk` parameter,
because they do opposite things with a chord — one egrenes it, the other re-strikes it whole — and
a word in a dropdown would hide that.

`stemsplit` separates offline into four files. It is filed under a `separation` category of its own
rather than among the utilities because that is where the libraries repository files it, and that
repository is the reference. There is no per-stem gain
module beside it: that compiles to `gain(Level)`, a multiplication, straight behind a platter node
that already has a linear `Gain` of the same range and rest. What the subtraction it replaced cost
to learn, measured, is in `packages/song-schema/docs/stems.md`.

Two modules have their own page, because their numbers are argued rather than read: `sweep`
(`docs/sweep.md`) and the wurlitzer (`docs/wurlitzer.md`). What the library itself imposes on all
of them — the three rates, the port index, `geolerp`'s guard — is in `docs/builder.md`.

## `fade` and `crossfade` — the same effect, and only one shape holds on a desk

Both fade between two signals. `crossfade` does it in **one** module with two ports; `fade` does
it with **two** one-port modules, driven in **mirror** by the same control. A `fade`'s parameter
IS its gain — 0 silent, 1 full — so its panel reads on its own, with no second number to translate
it through.

The arithmetic is identical. What differs is what each shape demands of the engine, and that is
where the second wins. A module's second port is wired as a **sidechain**, and a sidechain only
reads a track if that track actually reaches an audible output — measured five times, in
`engine/st0-engine/docs/sidechain.md`. A deck feeding only a crossfade is therefore heard **beside**
it, raw, and the fade can take nothing away from it. No mute, no unplugging, no routing to a sink
undoes that: everything that removes it from the master removes it from the fade.

Two `fade`s do not have this problem because they have no second port. Each side stays an ordinary
track with an ordinary output, and the sum happens at the mixer — where sums happen. The price is
one more module in the graph and one more rule in the desk's mapping: one control, two parameters,
one of them mirrored (`packages/song/docs/setProject.md`).

`crossfade` stays correct, and stays the right choice wherever its two inputs already live on the
same track. It is on a desk, where they do not, that it cannot hold.

## `normalize` — the graph is trivial, and that is the whole subject

`packages/dsp/src/normalize.ts` applies a gain, one node, and nothing else. Knowing **which** gain
is the hard part, and no block graph can answer it: a streaming node sees only the samples it has,
and the loudest can be the last. So the measurement is not there — `Peak` is an **input** to the
graph, filled by the cold pass that reads the file end to end
(`packages/song/docs/coldModules.md`), and what is left to describe is the arithmetic. That is
what makes the module *cold* rather than merely expensive: not that measuring costs too much live,
but that live there is nothing to measure yet.

Two details hold the rest. `Peak` defaults to **0 dBFS**: with no pass, the gain reduces to
`Target` and the module only attenuates, which is the harmless direction to be wrong in. And the
difference is **clamped** before going linear, because the arithmetic has a very loud degenerate
case: near-silence measures −100 dBFS and would ask for +99 dB, turning hiss into a full-scale
roar. +30 is generous for anything worth normalising and finite for everything else.

## It is not a seed

This folder is copied into no account library. **The reference is the account's libraries
repository**: what it holds is what a project inherits, and a build shipping its own copy of
someone's modules would be a second source of truth — two sources can only end up contradicting
each other. `initIfEmpty` does one thing: give a commit to a repository that has none, so it has
a branch for the next machine to fetch.

What that costs, said here because here is where you would come looking for a seed: **a new
library is empty**, so any `@st0/…` reference resolves to nothing until something is put in it —
including the four a scaffolded SET writes for its decks. And an unresolved reference **is not a
compile error** (`@studio/song`'s `docs/sharedFolders.md`): the module is simply absent from the
document, which looks exactly like a module that was bypassed.

## So what holds a module to any of this?

Nothing in this repo can open your library, which is the price of the library being the only source
of truth. Two things narrow the gap, and neither is a copy of a module:

- **The graphs are here as functions**, in `../src`, each with a test. A module's `jsdsp.ts` is that
  function written out — `crossfade.test.ts` compares the two shapes, both ways, so a module copied
  from one cannot silently drift from what is argued here.
- **The Faust compiler will walk a library**: `engine/st0-engine/tests/Faust_test.cpp` compiles every
  `.dsp` under `$STUDIO_MODULES`. Point it at yours before pushing one — that check is what was
  missing the day the wurlitzer reached an account's library without ever having compiled.

A module is written in st0, against a project where the plugin it names is actually LOADED, and
committed to the library. That is the only path in, and there is deliberately no second one.
