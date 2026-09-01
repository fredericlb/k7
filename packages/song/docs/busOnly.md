# `bus_only:` — dropping a bus's dry path

A fourth section of `graph.yaml`, beside `modules:`, `bypassed:` and `positions:`:

```yaml
bus_only: [ eqA, eqB ]
```

It says: **this bus is heard by its destinations and nowhere else.** Its own dry path to the
mixer sum is removed.

## Why it is not `bypassed:`

`bypassed:` already does **two** things depending on what you put in it — muting a **lane**, and
bypassing a **module** — and a bus chain is named after its first module: the chain `eqA` starts at
the rendez-vous point `eqA`, so its steps are `[eqA, filterA]`. Writing `bypassed: [ eqA ]` would
mute the bus **and kill the EQ**, silently. Both readings are legitimate and the file cannot
arbitrate. Two questions, two words.

| word | what it says | what it means in the document |
|---|---|---|
| `bypassed:` | this module is bypassed / this lane is muted | `enabled: false` on the step, or `mute` on the lane |
| `bus_only:` | this bus is heard only by its destinations | `mute` on the bus track, its plugins intact |

## Why one is needed at all

`out` compiles to a **parallel** path — that is what makes a send a send: the dry signal carries on
to the master alongside. That is the right default for a reverb.

It is not the right default for a deck strip feeding a fade *and* a cue: its dry output reaches the
master **without passing through the crossfader**, and every setting sounds the same. That is
exactly the failure [ports.md](ports.md) describes for a deck wired onto a single crossfade, and
that `scaffoldSet` avoids for lanes by muting them. A lane can say it with `bypassed:` because a
lane is no module's name. A bus cannot.

## What the engine does with it

`mute` on a track that has sends triggers `feedsBusOnly` in `EditBuilder.cpp`: the **first**
destination becomes an output ROUTING — which is what removes the dry path — and the rest stay
ordinary aux sends.

The order is not cosmetic, and it is measured: **a mute alone is not enough.** A muted track does
not feed its aux sends — it is silent everywhere, not only on the dry path.

| form | peak at master |
|---|---|
| two destinations, source muted, no routing | **−100 dBFS** — nothing anywhere |
| two destinations, source muted, first routed | −1.6 dBFS |
| two destinations, source unmuted | 0.0 dBFS — dry path included |

`npx tsx engine/st0-engine/scripts/cue-bus.ts` replays all three.

It is also why a track can have only **one** destination without a dry path: it has one output. The
others go through sends, post-plugin and post-fader on the source track — correct here, since fade
and cue are both downstream of the whole strip.

## Who writes it

A set's scaffold (`scaffoldSet.ts`) and the migration (`scripts/migrateSetCue.ts`), which share the
note placed above the key — `BUS_ONLY_NOTE`, one text, so both produce the same file byte for byte.
By hand otherwise: it is one line, and the graph does not write it from a click.

## What it is not

It is **not** a decision about every bus in the repository. `out` stays parallel everywhere else,
and a bus that does not name this word keeps its dry path. [ports.md](ports.md) poses the wider
question — making `out` serial — and it stays open: that is a decision about each bus in the
repository, not about ports or about the headphone feed.

See [cue.md](cue.md), which is why this word exists.
