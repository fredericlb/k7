# `masterVolume` — the song's output level

The one gain after everything else. Until it existed there was **no global output control in the
app at all**: `EditBuilder` pinned Tracktion's master fader to 0 dB and nothing could reach it —
no command mentioned the master, and `@engine/OUT` carries no level of its own.

```yaml
# project.yaml
project:
  name: danse
  tempo: 120
  masterVolume: -3      # dB, -100..+12 — 0 is unity
```

Set it with the **fader under the header meter**, or with `project master <dB>`. **Absent means
unity, and unity is never written**: `project master 0` removes the line rather than writing a
zero, the rule `type:` and a module's `status:` already follow.

## It belongs to the SONG, not to the machine

It moves playback, `--render` and a freeze **together**, and it travels in a share. That is why it
sits in `project.yaml` beside the tempo rather than in `settings.yaml` beside the metronome: a
level that only changed what you hear in this room would be a monitoring preference, which is a
different field in a different file and does not exist yet.

The engine already insisted on this pairing for the pin it replaces — a bounce that came back at
one level and played at another is audible the moment you freeze a track, and `clip process`,
which writes a render back onto the material, would drift a little further every pass.

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

- **It sits LAST on the master bus — AFTER the meter and after the broadcast tap.** The meter and
  the Fix button answer for the MIX; this trim is a delivery decision taken on top of it. Metered
  post-gain, a person who raised the output would see their own trim reported back as if the mix
  had got louder, and the Fix button — which lowers the *strips* — would rewrite every lane in the
  song to compensate for one number they had just set. The broadcast tap sits before it for the
  same reason: a listener hears the mix, not the level this room monitors at.

  **The cost, stated rather than hidden:** clipping caused *by* the trim is downstream of the
  meter, so the clip light will not see it. The meter answers "is my mix too hot", and pushing the
  output past what the interface can take is a separate question nothing currently asks.
- **It RAMPS across a block when it moves.** A master trim is one number for the whole mix, so
  stepping it between two buffers would click on everything at once — the one artefact that cannot
  be mistaken for a track's own. It starts *on* the current value when playback begins, or every
  press of play would fade the song in.
- **The engine's parameter is wider than the field** (to +24). The schema is what decides what a
  person may ask for, so widening again is a one-line change in `MASTER_MIN_DB` / `MASTER_MAX_DB`
  rather than an engine change.

Outside the range the value is **refused, not clamped** — a fader that answers 20 with 12 is worse
than one that says no, and a file that disagreed with the sound would disagree for ever.

## Why the output is rarely where a quiet mix's headroom is

Worth saying plainly, because this control invites the wrong expectation. If a song's strips sit
around -20 dB — which is ordinary for a mix built with headroom — then the master gives back
**twelve of those twenty**, and only by pushing the whole sum toward the ceiling it was left below. The rest of the headroom is in the strips, and the balance-preserving way to
reclaim it is to move them all by the same amount, which is what the header meter's Fix button
does in the other direction (`apps/st0/frontend/docs/masterMeter.md`).

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
| authored | `project.yaml`'s `project.masterVolume` — `ProjectSettingsSchema` |
| compiled | `ProjectDoc.masterVolume` — `nodeProject.ts`, `project.ts`, defaulted to 0 |
| the wire | `@studio/engine-protocol`'s `ProjectDoc` |
| decoded | `docFromJson` in `engine/moteur/server/main.cpp` |
| applied | `MasterGainPlugin`, first on the master list — set in `EngineHost.cpp` on build and on diff |
| drawn | the fader under the header meter (`apps/st0/frontend/docs/masterMeter.md`) |
| written | `project master <dB>` |
