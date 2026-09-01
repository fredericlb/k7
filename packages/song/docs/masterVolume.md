# `masterVolume` — the song's output level, which is the OUT node's `Volume`

The last gain in the song, and the app's **one global output control**. Tracktion's own master
fader is pinned to 0 dB by `EditBuilder` and nothing reaches it; the level the song carries is
this one.

```yaml
# project.yaml
project:
  name: danse
  tempo: 120
  masterVolume: -3      # dB, -100..+12 — 0 is unity
```

Set it with the **fader under the header meter**, with `node param "OUT" Volume <dB>`, or with
`project master <dB>`. **Absent means unity, and unity is never written**: 0 removes the line
rather than writing a zero, the rule `type:` and a module's `status:` already follow.

## It is a NODE's param, stored in `project.yaml`

`OUT` is one of the two built-in outputs ([masterChain.md](masterChain.md)) — a NAME rather than a
module on disk, so it has no `module.yaml` for a param to land in, and this field is where its one
param lives instead.

That is a storage detail, and everything above it treats the level as what it is: a param on a node
in the graph. `node param "OUT" Volume` is the spelling, the same one a mixer strip's fader commits
on its own node, and `project master <dB>` is that write under the name a person types. There is one
implementation (`writeMasterVolume` in `@studio/commands`), so the two cannot drift apart about the
range, the unity rule, or how the engine learns it.

`MIX` carries no level and refuses one by name. The mixer's sum is a place the signal passes
through; a level belongs to what LEAVES.

> The Fix button and this fader are the same act on the same number, which is why the level is a
> param of a node rather than a field beside the tempo with no presence in the graph at all. See
> [masterMeter.md](../../../apps/st0/frontend/docs/masterMeter.md).

## It belongs to the SONG, not to the machine

It is part of the document and travels in a share. That is why it sits in `project.yaml` beside the
tempo rather than in `settings.yaml` beside the metronome: a level that only changed what you hear
in this room would be a monitoring preference, which is a different field in a different file and
does not exist yet.

It moves playback, `--render` and a freeze **together**, and the engine insists on that pairing for
its own pin too (`EditBuilder`'s hard 0 on Tracktion's fader): a bounce that comes back at one level
and plays at another is audible the moment you freeze a track, and `clip process`, which writes a
render back onto the material, would drift a little further every pass.

> **The gain is created by `populateMasterChain`, which BOTH paths run.** An offline render calls
> `populateEdit` and nothing else, so a gain created by `EngineHost::buildLevelMeters` — the LIVE
> path only — would leave `--render`, a freeze and `clip process` bouncing at unity however this
> field read, with nothing to report it. The live path takes hold of that one gain through
> `masterGainOf` rather than making a second. `engine/st0-engine/scripts/master-chain.ts` is what
> measures it: a render at `-20` comes back 20 dB below the same render at unity, which is the only
> proof there is — no C++ test builds an Edit, and no TypeScript test renders.

## The ceiling is +12, and the engine owns it

Tracktion's own master fader stops at +6. Its curve is

```
pos = exp((dB - 6) / 20)      clamped to [0, 1]
```

so `pos = 1` ⟺ `dB = 6`, and **every value above +6 sets the same position** — `setVolumeDb` clamps
in silence. `MixerPlugin` borrows the same curve for a strip, on purpose, because a strip should
feel like the fader it replaces; its own comment says a taller range "would store a bigger number
and still play +6".

A master trim is the one place that is a limitation rather than a shape. A mix built with headroom
sits far below full scale, and asking for +12 on the output is ordinary. So this value is **not**
applied to Tracktion's fader at all: `MasterGainPlugin` — ours, first on the master plugin list —
takes dB straight to a linear factor with no curve and no clamp. Tracktion's fader stays pinned at
unity, which is what keeps the two from multiplying.

Three consequences worth knowing:

- **It sits on the master bus right after the song's own master chain — BEFORE the meter and
  before the broadcast tap.** The bus reads

  ```
  pistes -> [ chaîne master ] -> masterVolume -> vumètre -> tap de diffusion -> interface
  ```

  which is the order the graph reads: `MIX -> [chain] -> OUT`, and this gain is what `OUT` carries.
  Everything after it is the engine observing the signal that actually leaves, which is the point
  of observing it.

  **The meter reads the trim, and that is the price of one control instead of two.** Metering
  *before* the trim would only be right if the fader and the Fix button were separate acts — one
  writing this field, the other rewriting every mixer strip. Fix writes this very param, so a Fix
  the meter could not see would leave the clip light lit, offer itself again on the next pass, and
  take another 6 dB every time.

  **The two costs, stated rather than hidden:** raising the fader raises the bar above it — the
  meter answers "how loud is what leaves" rather than "how loud is my mix" — and a listener on the
  broadcast hears the level this room is set to. The second is the one to weigh if you monitor
  quietly while somebody listens remotely.
- **It RAMPS across a block when it moves.** A master trim is one number for the whole mix, so
  stepping it between two buffers would click on everything at once — the one artefact that cannot
  be mistaken for a track's own. It starts *on* the current value when playback begins, or every
  press of play would fade the song in.
- **The engine's parameter is wider than the field** (to +24). The schema is what decides what a
  person may ask for, so widening it is a one-line change in `MASTER_MIN_DB` / `MASTER_MAX_DB`
  rather than an engine change.

Outside the range the value is **refused, not clamped** — a fader that answers 20 with 12 is worse
than one that says no, and a file that disagreed with the sound would disagree for ever.

## Why the output is rarely where a quiet mix's headroom is

Worth saying plainly, because this control invites the wrong expectation. If a song's strips sit
around -20 dB — which is ordinary for a mix built with headroom — then the master gives back
**twelve of those twenty**, and only by pushing the whole sum toward the ceiling it was left below.
The rest of the headroom is in the strips, and reclaiming it means moving them — which this fader
cannot do for you and the Fix button does not try to
(`apps/st0/frontend/docs/masterMeter.md`).

And some of the gap is not headroom at all. A raw mix without mastering sits near -20 LUFS where
streaming services normalise to about -14, so it will read quieter than they do no matter where
this fader is. That difference is a limiter's job, and the repo already has the path for it: cold
modules (`docs/coldModules.md`), `normalize`, and the médiathèque's chain templates that run over a
song's master file.

## Live, without stopping the song

A change to it is diffed like the tempo — `ChangeKind::MasterVolumeChanged`, applied in place by
`EngineHost::apply`, which sets the parameter on the gain plugin it already holds. It deliberately does **not** force a full rebuild: a rebuild replaces the Edit
and the transport with it, so moving the master while the song plays would stop the song.

The field is **always sent**, defaulted rather than optional, for the same reason: the engine diffs
documents, so an absent field would read as *unchanged* against a doc that carried one, and a
master put back to unity would never come back down.

## The layers it crosses

| | |
|---|---|
| the node | `OUT` — `moduleTypes.ts`'s `OUT_NODE`, the interface end of the master chain |
| authored | `project.yaml`'s `project.masterVolume` — `ProjectSettingsSchema` |
| compiled | `ProjectDoc.masterVolume` — `nodeProject.ts`, `project.ts`, defaulted to 0 |
| the wire | `@studio/engine-protocol`'s `ProjectDoc` |
| decoded | `docFromJson` in `engine/st0-engine/server/main.cpp` |
| applied | `MasterGainPlugin`, put on the master list by `populateMasterChain` after the song's chain and before the meter — so playback and an offline render both get it — and re-set in `EngineHost.cpp` on diff |
| drawn | the fader under the header meter, the Fix button beside it (`apps/st0/frontend/docs/masterMeter.md`), and the OUT card's own fader in the chains graph (`MAIN_OUT_UI`) |
| written | `node param "OUT" Volume <dB>`, or `project master <dB>` — one implementation, `writeMasterVolume` |
