# The blindtest's nine effects, remade for the studio

z0 deforms an excerpt with nine effects, written in WebAudio in
`packages/player-web/src/audioEffects.ts` and stored in a Grist session as nine `fx_*` columns.
This page says what each one corresponds to studio-side, what is faithful and what is not.

The rule: **jsdsp when the graph vocabulary can express it, the engine otherwise.** Nothing is
added to the C++ — the two effects a graph cannot describe are internal plugins.

| z0 effect | becomes | form |
|---|---|---|
| `lowpass` | `@st0/audio/filter/lowpass` | jsdsp, faithful |
| `highpass` | `@st0/audio/filter/highpass` | jsdsp, faithful |
| `overdrive` | `@st0/audio/distortion/overdrive` | jsdsp, faithful but for the normalisation |
| `chorus` | `@st0/audio/modulation/chorus` | jsdsp, faithful |
| `pitchvar` | `@st0/audio/modulation/wobble` | jsdsp, different mechanism |
| `phaser` | `@st0/audio/modulation/phaser` | jsdsp, **accepted approximation** |
| `bitreduction` | `@st0/audio/distortion/bitcrush` | engine — AirWindows De Rez |
| `pitch` | `@st0/audio/utility/pitch-shift` | engine — Tracktion Pitch Shifter |
| `speed` | nothing: it is not a treatment | stays `speed:` on the session's song |

The first six carry a single `Amount` parameter, 0 to 100, because that is exactly what a
blindtest question writes. The curves are z0's: the lowpass descends 20 kHz → 200 Hz
geometrically, the chorus sweeps 0.2 to 5 Hz over 20 ms, the overdrive pushes tanh from 1 to 50.

## How a question carries its effects

Not in the YAML. A deformed question is **a version of the song**, and the médiathèque already
knows how to hold a song's versions: its sidecar lists them under `variants:`, and a value that
does not name a file beside the master names a **chain**
([variants.md](../../../packages/mediatek/docs/variants.md)).

```yaml
# chains/blindtest/deformees/blue-monday.yaml — pitch → wobble → highpass → chorus → overdrive
steps:
  - id: a3bf6b9a-…
    extends: "@st0/audio/zz_utility/pitch-shift"
    params:
      "semitones up": 5
  - …
  - to: [ { chain: "@out" } ]
```

```yaml
# songs/New Order/Album inconnu/Blue Monday/song.yaml
variants:
  "deformees": "blindtest/deformees/blue-monday"
```

```yaml
# the category, in the session
name: Déformées
variant: deformees
```

**One name on the category, one chain per song.** That is what makes it "templated" in the right
place: the session YAML says `deformees` once, and each sidecar resolves that word to its own
values — the ones a person set question by question, which are the question's identity. A single
chain shared by every song would be a template that loses what it templates. Two songs with
*identical* settings do share one chain: deduplication is on the effect map, not on the name.

The module order in a chain is fixed — pitch, wobble, bitcrush, lowpass, highpass, phaser, chorus,
overdrive — pitch first because it resynthesises, saturation last because it comes after shaping.
z0's own WebAudio player has no order at all: it chains effects in Grist column order.

Which gives **16 chains** for 20 variant slots across 20 sidecars, under 3 categories (`Déformées`
twice, one per session, and `Assourdissant`). The 15 songs of `Slooow` got none: they carry only
`speed`.

## What is not faithful, and why

**The phaser.** z0 stacks four allpasses swept by an LFO. The graph vocabulary
(`engine/st0-engine/engine/DspGraph.h`) can do neither, and both reasons are worth writing once:

1. `biquad` knows four modes — bandpass, lowpass, highpass, notch — and **not allpass**.
2. A first-order allpass needs `y[n−1]`, and **no graph can hold it**. The only node writing a
   *named* wire is `adelay`, whose read is bounded to one sample minimum; reading that wire before
   its writer therefore yields `y[n−2]`. Exactly one sample of feedback is the thing the loop
   cannot express.

So the module is a **swept comb**: dry minus a short moving tap. To the ear the same gesture; on a
trace, harmonic notches where a real phaser has irregular ones. Adding an allpass mode to `biquad`,
or a block-rate LFO to sweep one, would make the exact version trivial — ten lines of graph. The
engine's built-in `@engine/phaser` is a real phaser, but its three controls (Depth, Rate, Feedback)
are separate: no single knob, so not the shape of a question.

**The wobble.** z0 sums three LFOs onto the source's detune. Nothing here retunes a buffer, so the
pitch comes from where it comes from on tape: a delay line whose length moves. The three
frequencies are z0's (0.23 / 0.71 / 1.37 Hz), mutually irrational so the flutter is never
predictable. What is missing is the random drift z0 injects every 800 ms: a graph is a description,
evaluated identically every time, and there is no noise source in that vocabulary.

**The overdrive.** Same `tanh(drive·x)` curve, drive 1 to 50. z0's normalisation divides by
`tanh(drive)`, and there is no control-rate `tanh`; above drive 4 that divisor is 1 to within half
a per cent, so a two-point ramp covers the bottom of the knob.

**The bitcrush.** The only one of the nine a graph cannot describe *at all*: quantising needs a
round, and this vocabulary has neither round nor division. So it is De Rez, the AirWindows effect
Tracktion ships, with its two controls `Rez` (word length) and `Rate` (clock). There is no single
0-to-100 knob: the plugin has no such input.

**The pitch.** Shifting pitch without moving the clock needs a windowed resampler, that is an
algorithm and not a graph of primitives. The engine already hosts one. And it is the one place the
studio version is **better** than z0's: z0 detunes the source, which speeds the song up too; this
one does not touch duration.

**The speed.** `speed` is not an effect — it is playback rate, `playbackRate = v/10` on the
WebAudio source. No module can change it: a module is an insert, it sees samples and has no clock.
No chain either, so `speed:` stays **a field on the song in the session**, the sole survivor of the
nine `fx_*` columns. On a clip the studio expresses it with two `warp:` markers
(`{ algorithm: elastique, markers: [[beat, seconds], …] }`, see
`packages/song/src/nodeProject.ts`) — which stretches time *without* dropping pitch, where z0 does
both at once. "warp + Pitch Shift" reproduces z0's gesture.

## The phase belongs to the backend

**The game's phase is decided on the server**, and `backend/src/game/phase.ts` is the only place
that changes it. `setServerPhase` is the single crossing point — `flushBuzzes`, `remote_action`
dispatch, `handleNext`, the registration lock all go through it — and it does three things at once:

1. it **derives the buzzer lock** from the new phase. `phaseAcceptsBuzzes` is the only definition:
   `song` and `registration` are open, everything else closed. Nobody sets `buzzersLocked` by hand;
2. it **persists** the state;
3. it **broadcasts** `phase_change` to every client, main screen and buzzers.

Doing otherwise — letting a screen set its phase and announce it — breaks as soon as there are two
remotes or two buzzers racing, which is the normal case.

Unlocking is not symmetrical with locking, deliberately: reopening the buzzers **re-emits a
targeted `locked: true`** to devices still in penalty, with the time they have left. Without that,
a wrong answer punished with a cooldown would be pardoned by the next question.

And a buzz is not handled immediately: buzzes are **collected for 150 ms** and the oldest timestamp
wins. That is what makes the race playable on phones with varying network latency; it is also why
`flushBuzzes` is the only place that moves `song` → `answering`.

## Who plays the sound, and who draws it

Only one of the six SPAs holds an `AudioContext`: **`monitor-web`**. Its `audioPlayback.ts` owns
`@studio/player-web`'s `SongPreloader` and drives it from the WebSocket (`next`, `phase_change`,
`audio_command`). The presenter plays nothing: it has only its buzz beep and the last-three-seconds
tick, two ordinary `<audio>` elements.

That explains half a dozen oddities that read one by one as omissions:

- **The presenter does not preload.** `preloadCategory` is passed to it as a no-op: `monitor-web`
  reacts to the *same* `next` and does the preloading for real. The presenter sees only the
  reflection, through the `preload_progress` / `preload_failed` broadcasts that feed its bar.
- **It never needs a user gesture.** An `AudioContext` only starts after a click; with no context
  there is nothing to unlock, so the screen resumes the game by itself on load instead of showing
  a "click to start".
- **Its timecode stays at `0:00`.** Playback time is on the other machine; showing it would need a
  broadcast per frame for a decorative number.
- **The score/reveal/multi state machine is in `monitor-web`.** The presenter receives
  `reveal_state` and `multi_state` and draws them, full stop — hence fields like
  `multiRemovedTracks` that no local logic writes.
- **Intentions go out as `audio_command`** (`play`, `pause`, `stop`, `set_gain`,
  `set_playback_rate`, `set_duck`, `mute_multi_track`…). It is the only vocabulary by which a
  screen asks anything of the sound.

And one consequence for message order: the backend broadcasts `phase_change` **before** `next`. The
phase listener therefore writes first, and the presenter's own render phase (scoreboard, pause,
mystery-question), set by the `next` handler, wins on the same tick. Swapping the two broadcasts
would make the phase flicker.

### Playlist mode plays differently

`online/src/lib/playlistPlayer.ts` is not a `SongPreloader`: it is **two `<audio>` elements taking
turns**, one playing while the other preloads the next track. The reason is memory — a decoded 30 s
stereo excerpt costs ~10 MB of RAM, so fifty tracks would pass half a gigabyte. The price is that
**no WebAudio effect applies**, which suits: a playlist carries none, and all its categories are in
`""` mode.

**The draw happens here, not in the backend.** `/playlists/:id/tracks` answers "what is in this
playlist"; an endpoint returning a different order on each call would lie about what it describes.
The order you are *quizzed* in is a property of the game, and `sessionFromPlaylist` is the seam
where a playlist becomes one. The draw happens **once per selection**, so it holds for the whole
round and changes only by re-picking the playlist — and nothing is lost by redoing it, since a
playlist round keeps no resume point. A prepared session keeps its written order: that one is
composed, and `order`'s `from`/`to` slices it by index.

Each song's `path` targets the backend's redirect rather than a CDN URL, for the same reason: a
Deezer signature dies after a quarter of an hour, and a slightly long game would stall mid-way.

Two consequences in that file: preloading **never rejects** (it resolves on `canplaythrough`, on
error, or on a 15 s timeout), because the game's entry gate awaits it and a dead track must not
freeze the game; and `resumeContext()` must be called **synchronously** from the start click,
before any `await`, or the browser refuses the programmatic `play()` that follows.

Finally, `monitor-web` can **resume after a reload**: the backend does not rebroadcast the current
`next` on connection, so the page fetches `/api/game` itself and replays it, preloaded category
first so the `song` event finds its buffers cached.

## Where the sources live

On the médiathèque volume, `modules/audio/<category>/<name>/`, which is the only editable catalogue
(see `AGENTS.md` at the root). Each jsdsp module holds four files: `module.yaml`, `jsdsp.ts` — the
source, the file you edit —, `jsdsp.json` — the build, regenerated whenever the source is newer —
and `ui.yaml`, the panel.

The `.json` is not a cache you may ignore: it is what goes into the document, because the engine
reads no file. `compileNodeProject` re-runs the source in a child process when it is newer and
rewrites the `.json` beside it.

## What is verified

Without playing a note — a second engine beside the running one would block the ASIO driver, which
`engine/st0-engine/AGENTS.md` tells in detail:

- the eight modules resolve through `loadModuleRefs`, with **zero anomalies** over the whole
  library (`libraryModuleIssues`);
- a project inserting one compiles: the six jsdsp arrive as `type: "DSP Graph"` with their inline
  graph, `bitcrush` as `"De Rez"` and `pitch-shift` as `"Pitch Shifter"`;
- the six graphs build with the real `GraphBuilder` and use only node types `DspGraph::build`
  accepts;
- the **16 chains** go through `readTemplate()` — the reader a bounce and the bench use — and
  return the expected step sequence, every step naming an existing module;
- session-side, each category `variant:` finds, for every song concerned, either a file beside the
  master (28) or a chain that exists (20); 18 fall back to the master, which is the rule.

What is not verified, and cannot be here: **the sound**. None of these settings has been listened
to.
