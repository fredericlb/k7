# Project and settings files

Two files at the root of a project hold its global settings: `project.k7x` (the song) and
`settings.k7x` (how recording behaves).

## project.k7x

The file has two levels. The song's own settings sit under `project:`; the track order, solo state
and markers sit at the root beside it. Both levels are strict: a key k7 does not know, or a key
written at the wrong level, is refused and the project does not load until it is fixed.

```k7x
project({
  name: "My song",
  tempo: 120,
  sampleRate: 48000,
  timeSignature: "4/4",
  tags: ["demo", "live"],
})
markers({ "1:1": "Intro", "9:1": "Verse", "17:1": "Chorus" })
soloed(["vocals"])
```

The same file as k7x:

```js
project({
  name: "My song",
  tempo: 120,
  sampleRate: 48000,
  timeSignature: "4/4",
  tags: ["demo", "live"],
})
markers({ "1:1": "Intro", "9:1": "Verse", "17:1": "Chorus" })
soloed(["vocals"])
```

### Fields under `project:`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `name` | text | `untitled` | The song's name as shown in k7. |
| `uuid` | text | none | A stable identifier, written by k7. |
| `tempo` | number above 0 | `120` | Beats per minute. |
| `sampleRate` | whole number above 0 | `48000` | The rate the song is played and rendered at. |
| `timeSignature` | text `N/D` | `"4/4"` | The metre. Must look like `4/4`, `6/8`, `7/8`. |
| `masterVolume` | number, −100 to 12 | `0` (unity) | The song's output level in dB: the fader under the header meter. |
| `console` | text `@<library>/console/<name>` | none | A summing console placed over the whole mix, chosen from a library's `console/` folder (for example `@k7-core/console/console-5`). |
| `viewport` | `[width, height]` or `[width, height, fps]` | none | The picture frame in pixels, for a project with video lanes. The fps is used by export only. There is no default frame. |
| `layers` | list of names | none | The picture lanes in draw order, bottom first. Every `video_tracks/` file must be listed, and every name must have a file. |
| `tags` | list of text | none | Words the home page files the song under. Compared without case; written by the `project tag` command. |
| `video` | true/false | — | Accepted and ignored. Whether a song has picture is decided by its `video_tracks/` folder and its surfaces. |
| `modules_from`, `libraries_from` | lists | — | Accepted and ignored. |

### Root fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `markers` | map of timecode → label | none | Named positions on the timeline. Keys are [positions](./31-timecodes.md), quoted. |
| `trackOrder` | list of lane names | none | The order of lanes, bottom first. |
| `soloed` | list of lane names | none | The lanes currently soloed. Several may be soloed at once; this is project state, saved with the song. |
| `highlighted` | list of lane names | none | Lanes heard 10 dB up on their strip, without moving their fader. |
| `type`, `project_type` | text | — | Accepted and ignored. Which app opens a project is decided by its folder suffix. |

A marker whose key does not read as a timecode is skipped rather than failing the load.

## settings.k7x

A flat file of recording preferences. Every field may be left out; a partial file never fails the
load. Unlike `project.k7x`, unknown keys are tolerated.

```k7x
metronome(true)
metronome_level(0.6)
count_in(1)
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `metronome` | true/false | `false` | Whether the click plays. |
| `metronome_level` | number, 0.2 to 1 | the engine's default | How loud the click is. Not a way to silence it: use `metronome: false`. A value outside the range is refused by the editor. |
| `count_in` | whole number, 0 or more | `1` | Bars of count-in before an armed lane starts recording. `0` records immediately. |

## Archetypes

A project is created from one of five archetypes. Each writes a different set of starting files; the
files are then yours to change.

| Archetype | What it opens on | Files it writes |
|---|---|---|
| `arrangement` | A timeline | `project`, `settings`, a melody lane playing `sequences/melody` through a synth, two Strudel lanes (`pad`, `kit`) on `algo/pattern.strudel`, a group lane `live` holding them, an empty `curves/`, and `surfaces/timeline`. Written in the chain layout. |
| `video` | A timeline and a viewport | Everything `arrangement` writes, plus `viewport: [1280, 720, 30]` and `layers: [main]` in `project`, a sample video in `clips/`, `video_tracks/main`, the `RENDER → VIDEO_OUT` run, and `surfaces/viewport`. |
| `mix` | A DJ desk | A set: `project` with only a name and a sample rate (a set has no bars), `mix.k7x` (the cue sheet), two decks with their strips, one turntable assembly per deck (`assemblies/`), and `surfaces/desk` of type `turntables`. Written in the graph layout. See the DJ & sets section. |
| `live` | A rig you play through | An input `IN`, a `fader` (the shared mixer strip), a recorder `rec` on the master run, `settings`. No lane, no timeline. Chain layout. |
| `live-video` | A rig with a camera | `live` plus a camera node `CAM`, the picture run, `viewport: [1280, 720, 30]` in `project`, and `surfaces/viewport`. |

The new project also creates the workspace module `_modules/instruments/synth` (Tracktion's
built-in 4OSC) the first time, which the `arrangement` and `video` lanes extend.
