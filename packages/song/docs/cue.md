# `CUE` — the headphone bus, and why it is a graph node

A fifth built-in node, beside `MIX`, `OUT`, `RENDER` and `VIDEO_OUT`:

| name | what it is |
|---|---|
| `CUE` | **a second pair on the interface** — the headphones. The only output that really leaves the mixer's sum |

```yaml
# graph.yaml
modules:
  filterA: [ fadeA, cueA ]   # TWO destinations: the room, and the headphones
  fadeA:   [ MIX ]
  cueA:    [ CUE ]
```

This is what a two-deck desk needs to be one: cueing deck B while A is playing. See
[packages/st0-plugins/docs/turntables/cue.md](../../../packages/st0-plugins/docs/turntables/cue.md).

## What it settles, and what it does NOT

The engine has **one** transport, and cueing never asked for two: both decks already play **at the
same time** on the timeline, and the crossfader decides what the room hears. Only a second output was
missing. Out of reach with a single transport: starting a deck independently, and a cue point that
moves only that deck. See [packages/st0-plugins/docs/turntables/mix.md](../../../packages/st0-plugins/docs/turntables/mix.md).

## `OUT` is a notation; `CUE` is a real destination

Routing a track to `OUT` short-circuits nothing, because **every** track feeds Tracktion's master bus
— both names are a notation that makes the master chain expressible ([masterChain.md](masterChain.md)).
`CUE` is the one name that designates something else: a track routed **off** the master bus, onto a
separate output device.

## Where the headphones come out: a question of MACHINE

The project says `CUE`. It does not say which pair — an interface has a headphone socket whatever
song is open, so that is a fact about the rig, filed with the others:

```yaml
# <state>/preferences.yaml
cueOutput: [3, 4]      # or "casque", a label from `channels.out`
```

```bash
system cue 3+4          # or: system cue casque
system cue ""           # "this machine sends cue nowhere"
```

Exactly the path a track's `input:` already takes: both forms are accepted, the label is resolved
**before** the engine, which only ever sees numbers (`resolveCueOutput`).

## Silence is the fallback, never the master

The rule that counts, and it is worth three independent gates:

> A `CUE` bus this machine cannot output plays **nowhere**.

Falling back to the sum would put the headphone feed into the room, at full level, with nothing to
signal it. That is the failure you do not want to discover in public.

| when | where it is closed |
|---|---|
| no `cueOutput` on the machine | the compiler emits the bus with `mute: true` |
| a named pair, absent at runtime | the engine routes to an id matching nothing — `canPlayAudio()` goes false |
| an offline render (mixdown, freeze) | `tracksOnTheMix()` excludes the track from the bounce |

The third is not belt-and-braces: track routing is a **playback** notion, and `tracksToDo` does not
consult it. Without it a delivered mixdown contains the headphone feed. See
[engine/st0-engine/docs/cueOutput.md](../../../engine/st0-engine/docs/cueOutput.md).

## The CUE button is not a switch

There is **no** switching in the engine. `cueA` is a node of the `fade` module, its `Mix` is how much
of that deck leaves for the headphones, and the desk's button is that link going from 0 to 1 — the
same mechanics as the crossfader and the stem cuts. One path fewer. At rest `Mix: 0`: a set starts
with nothing in the ears.

## The tap point, and why it is there

`filterA`, so **after the EQ and the filter, before the fade**. That is what pre-fade listen means:

- moving the crossfader away from a deck must not take it out of the ears — otherwise you cannot
  prepare what is coming;
- cutting its low end must be audible **before** it reaches the room.

The cascading consequence: `filterA` has two destinations, so the `eqA` chain no longer absorbs them,
and both `fadeA` and `cueA` become separate buses. Which forces the **dry** path off the strip track
— what `bus_only:` says, for a name-collision reason kept in [busOnly.md](busOnly.md).

## Migrating a set that has none

```bash
npx tsx packages/song/scripts/migrateSetCue.ts <project.st0> [others…]
npx tsx packages/song/scripts/migrateSetCue.ts <project.st0> --write
```

Dry by default, idempotent, and through the `yaml` package's `Document` API — the scaffold's comments
and key order come back byte for byte.

Per deck: a second destination on its filter, a `cue<X>: [ CUE ]` line, a node file, a mapping line,
and its **strip** in `bus_only:`. That last is the only non-obvious point, and forgetting it breaks
nothing visible — it just makes every crossfader position sound the same.

Everything is read off the project rather than assumed: the tap point from `<deck>.filter`, the strip
from `<deck>.eqLow`. A deck whose mapping names neither is **refused by name** rather than half-wired
— inventing a node name would write a send nobody asked for. And `<state>` is untouched: the
headphone pair belongs to a machine, so `system cue` stays to be done, once per machine.

A test freezes the property that would rot in silence — a migrated set is **exactly** the set the
scaffold writes today (`src/migrateSetCue.test.ts`), the "before" derived by stripping the cue out of
a fresh scaffold, so the fixture cannot drift from the template.

## The layers crossed

| | |
|---|---|
| written | `graph.yaml` — a `CUE` destination |
| the word | `CUE_NODE` in `@studio/song-schema`'s `moduleTypes.ts`, in `BUILTIN_OUTPUTS` |
| the machine | `cueOutput` in `preferences.yaml`, written by `system cue`, read by `resolveCueOutput` |
| compiled | `nodeProject.ts`: the bus track carries `outputChannels`, or `mute` if there is no pair |
| the wire | `TrackDoc.outputChannels`, an exact mirror of `inputChannels` |
| decoded | `docFromJson` in `server/DocJson.cpp` |
| applied | `routeTrackOutput` — from `populateEdit` AND from the live diff |
| diffed | `ChangeKind::TrackOutputChanged` — applied in place, no rebuild |
| excluded | `tracksOnTheMix()` in `OfflineRender.cpp` |
| measured | `engine/st0-engine/scripts/cue-bus.ts` |

## Checking it

```bash
npx tsx engine/st0-engine/scripts/cue-bus.ts
```

Two sources, one on the mix and one on the cue, rendered changing nothing but the cue bus's
`outputChannels`:

| render | peak |
|---|---|
| cue routed to pair 3+4 | **−7.5 dBFS** |
| the cue source REMOVED from the document | **−7.5 dBFS** — identical |
| the same bus left on the mix | −1.7 dBFS |

The assertion is an **identity**, not a "quieter": routed elsewhere must be indistinguishable from
never having been there. Two IDENTICAL notes swing that figure by 7 dB from pass to pass, a 4osc's
start phase not being fixed — hence two different notes. And a silent bus proves nothing, an empty
mixdown being also what a broken render looks like — hence the source that stays on the mix in all
three passes.

**What is not verifiable here is the listening.** That a render does not contain the cue can be
measured; that the headphones actually come out on 3/4 of the interface cannot.
