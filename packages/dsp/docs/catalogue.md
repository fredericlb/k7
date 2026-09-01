# `modules/` — the modules written here, and what the folder is for

`packages/dsp/modules/` holds modules **written in this repo**: their `module.yaml`, their panel,
and the `jsdsp.ts` or `dsp.dsp` that makes the sound.

```
packages/dsp/modules/
  audio/filter/{eq3,sweep,moogladder}/
  audio/utility/{crossfade,fade,tempo,normalize}/
  audio/separation/stemsplit/
  audio/dynamics/quick-master/
  instruments/synth/wurlitzer/
```

The first segment is the **type folder**, which decides what a module IS (`audio`, `instruments`,
`transformers`, `io`… — see `@studio/song`'s `docs/loader.md`). The second is its **category**,
which decides only where it sits in a picker. That is why the EQ is under `filter` and not under
`utility`, though both are audio modules.

`quick-master` is the only one that **does not make its sound here**: no `jsdsp.ts`, no `dsp.dsp`,
only an `extends: "@engine/quick-master"` and defaults over it, the way `eq3` sits on the engine's
equaliser. What it names is a compiled built-in, and `engine/st0-engine/docs/quickMaster.md` says why
it could not be a graph: `DspGraph`'s primitives can neither split bands nor reach the difference
between the two channels.

`separation/` holds one module, `stemsplit`, which separates offline into four files. It keeps a
category of its own rather than a place among the utilities because that is where the libraries
repository already files it, and that repository is the reference. There is no per-stem gain
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
each other. `initIfEmpty` does one thing: give a commit to a repository that has none, because a
gitlink has to point somewhere.

What that costs, said here because here is where you would come looking for a seed: **a new
library is empty**, so any `@st0/…` reference resolves to nothing until something is put in it —
including the four a scaffolded SET writes for its decks. And an unresolved reference **is not a
compile error** (`@studio/song`'s `docs/sharedFolders.md`): the module is simply absent from the
document, which looks exactly like a module that was bypassed.

## What the folder is for

- **A source** for the DSP this package exposes: `crossfade.test.ts` compares the folder's
  compiled graph to `src/`'s function, both ways, so they cannot drift.
- **A bench for the engine**: `engine/st0-engine/tests/Faust_test.cpp` compiles the `.dsp` files from
  here (`STUDIO_DSP_MODULES`), the wurlitzer first.
- **A model to copy** into a library, by hand or from st0 — which is where a module is written,
  against a project where the plugin it names is actually loaded.

There is nothing to regenerate and nothing to commit twice: adding a module here gives it to
nobody, and that is the point.
