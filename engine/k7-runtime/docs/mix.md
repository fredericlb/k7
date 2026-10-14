# The engine's stage — `@mix`, `@input-volume`, `@output-volume` around any plugin

A module's `mix:` (0 all dry, 1 all wet) is a blend the ENGINE makes around the module's plugin. The
plugin knows nothing of it. The compile sends it as the plugin's `@mix` param, a knob sets it live
through `set-plugin-param` like any param, and `applyPluginParams` and the live setter both hand it
to `setModuleMix` (`engine/MixBlend.cpp`) instead of looking for a plugin param of that name.
`scripts/mix-probe.ts` checks it against a running engine.

## Why the engine, and not the plugin's own dry and wet

Every effect then has the same MIX, whatever it wraps. A plugin's own blend has as many spellings
as there are plugins — `Mix`, `Dry/Wet`, a `Dry Level` and a `Wet Level`, or nothing — and a
panel built on it needs a rule per spelling (the crossfade knob was one). Tracktion wraps SOME
plugins in a dry/wet of its own (external VST3/AU, AirWindows, the IR loader): those two params
are left alone, at their defaults, and `@mix` is applied on top like on any other plugin.

## The plugin's own blend is HELD, and stating one is refused

Blending on top of a plugin that still blends inside would stack two dry/wets: a reverb resting at
a third wet reads 100 % on the MIX knob and plays a third. So once the engine owns a module's blend,
the plugin's own is held where it cannot fight it — every param whose name holds *wet* or *mix* at
its maximum, one holding only *dry* at its minimum (`holdOwnMix`). A live set of one of them is
refused with a warning. The names are the ones `ownMixSide` reads in `@studio/song-schema`, so the
compile and the engine agree on which params these are.

WHICH modules own their blend is the compile's decision (`packages/song/src/ownMix.ts`): an EFFECT
(`audio/`) with at most one declared input. The compile always sends such a module's `@mix` — its
`mix:`, else 1 — and `@mix` arriving at all is what tells the engine to hold. Two exceptions, both
decided by what a module IS rather than by a list of names:

- **A module with two inputs keeps its `Mix`.** A crossfade's blends A against B and is no dry/wet.
- **An instrument is never held.** 4OSC's `Mix` params mix its oscillators.

A module whose `params:` names one of the held params — or inherits one — does not compile: the
error names the node and says to write `mix:`. Silently overriding it would leave a file claiming a
sound it does not make. `packages/song/scripts/migrateEngineStage.ts` rewrites a workspace and its
libraries: an authored dry/wet becomes `mix:`, read on the equal-power curve when it is two levels
(and the level change it costs reported), a proportion read straight.

The Fade module's one param is `Level`, not `Mix`: it is a lane's GAIN — two mirrored are the desk's
crossfader, one is the cue send — and a name holding *mix* would have it held at full.

## The two levels on the same stage

`@input-volume` (any audio module) and `@output-volume` (any module with audio out, an instrument
included) are dB, −60..+12, written `input_volume:` / `output_volume:`. They live on the same pair:
the split trims the input BEFORE keeping the dry copy, so the blend mixes back the signal the module
actually heard; the blend sets the output LAST, bypassed or not, since it is the module's level and
not its effect's. An instrument has no input to trim and gets the blend alone. Both ramp per block.

They replace the plugin's own the way `@mix` replaces its dry/wet: a param named plainly as its
input or output level — `Input`, `Output`, `Input Gain`, `Out Level` — is held at its OWN default
(`holdOwnLevel`), refused live, and refused in `params:` by the compile. The default and not 0,
because a plugin's neutral is where its author put it: the auto-wah's `Output` rests at 15 dB.
`scripts/volume-probe.ts` checks the two levels against a running engine.

On a LANE, `@output-volume` is the mixer fader rather than this stage. On a module's card the three
are drawn by k7 on the second line of the card's header, never on the panel
(`packages/ui-chains-react/docs/nodeCard.md`).

## A split and a blend, found by adjacency

The first `@mix` below 1 puts two plugins of ours around the module: `MixSplitPlugin` right
BEFORE it, which copies the input into a ring, and `MixBlendPlugin` right AFTER it, which mixes
that dry signal back into the module's output. They share a `MixLink`; nothing else knows them.

They are found by POSITION — the split is the module's left neighbour, the blend its right one —
rather than kept in a map of the session's. So every place that places or removes a module has
to step over them, and does: `indexAfterModule` for a module added after another (a full build,
the master chain, a module added by the diff), `removeMixPair` for a module taken out. A map would
be a second record of what the plugin list already says, and the one to go stale.

The pair appears on the first mix below 1, and stays: a mix set back to 1 leaves it in place,
passing the output through untouched, so a knob swept to the end and back never rebuilds a chain.
A module that never had a mix never has a pair.

## The dry signal waits for the wet one

The dry copy is read back delayed by the module's own latency, read in the blend's `initialise`,
which Tracktion calls again whenever a latency change rebuilds the graph. Without it, a plugin
with lookahead would be blended against a dry signal ahead of it, a comb filter at every setting
in between. Tracktion's own dry/wet does not do this.

## The curve, the ramp and the bypass

- **Equal power**: wet × sin(m·π/2) + dry × cos(m·π/2), the power constant across the sweep for a
  dry and a wet signal that differ, which is what an effect makes. The same curve as the crossfade
  knob (`packages/ui-chains-react/docs/widgets.md`).
- **A ramp per block** from the gains the last block ended on, so turning the knob does not step.
- **A bypassed module is left alone**: what came through it IS the dry signal, and blending it with
  itself would add 3 dB.

## What it refuses

An INSTRUMENT has no dry signal: its input is the silence before it. `setModuleMix` warns and
does nothing there. The builder offers `@mix` only on a module filed under `audio/`.

## Taking it out of the file

A param removed from a module is normally left where it was. `@mix` is the exception: its absence
means all wet, so the diff sends 1 when a module stops stating one.
