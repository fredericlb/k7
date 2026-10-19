# Lanes and events

A **lane** is a row of the timeline. In k7 a lane is a node like any other: its file says which
built-in lane module it extends, and what it plays. Where its signal goes is said by the chain or
graph that names it (see [Chains and the graph](./36-chains-graph.md)).

In the chain layout, a lane's file is `tracks/<lane>.k7x`. In the graph layout, it is
`nodes/<lane>.k7x`. The file's name is the lane's name. Picture lanes are different files, in
`video_tracks/` (see [Picture, surfaces and other files](./37-picture-surfaces.md#video-lanes)).

```k7x
// tracks/drums.k7x
extends("@meta/track")
color("#e0a030")
events([ref("kick").start("1:1:1").loop(4), ref("snare").start("3:1:1").fadeOut("0:1")])
```

```js
// tracks/drums.k7x
extends("@meta/track")
events([ref("kick").start("1:1:1").loop(4), ref("snare").start("3:1:1")])
```

## The three kinds of lane

| `extends` | Kind | What it plays |
|---|---|---|
| `@meta/track` | An ordinary lane | The clips and sequences its `events:` place. |
| `@meta/strudel-track` | A generated lane | A Strudel pattern named by `strudel:`, while the transport rolls. See [Strudel pattern files](./38-strudel.md). |
| `@meta/group-track` | A group | No material and no signal: it gathers the lanes listed in `tracks:`. Muting or soloing a group mutes or solos its members. |

A lane is not typed by its signal. It offers two outputs, `audio` and `midi`, and each event leaves
by the one its material fits: a clip's sound by `audio`, a sequence's notes by `midi`. When a lane
holds only one kind, a bare connection is enough; when it holds both, or nothing yet (a Strudel lane),
the chain or graph names the port (`pad#midi`).

## Lane fields

| Field | Type | Applies to | Meaning |
|---|---|---|---|
| `extends` | reference | all | One of the three lane modules above. |
| `events` | list of events | `@meta/track` | What plays, where, and how many times. See below. |
| `strudel` | text `algo/<name>.strudel` | `@meta/strudel-track` | The pattern file this lane plays. |
| `tracks` | list of lane names | `@meta/group-track` | The group's members. |
| `color` | text | all | The lane's colour on the timeline (for example `"#e0a030"`). Lanes without one get an automatic colour. |
| `disabled` | true/false | all | Leave the lane out of the render entirely, chains and all. Different from muting it. |
| `video_source` | name of a picture lane | `@meta/track` | Make this lane play the sound of a picture lane's shots; its events are derived from that lane. |
| `frozen` | text | all | The lane is frozen at this point: a render stands in for everything upstream. Written by k7. |

A lane's mute is not a field of its file: it is the lane's `bypass` in its chain (or its entry in
`bypassed:` in the graph layout). Solo and highlight are kept in `project.k7x` (`soloed`,
`highlighted`).

A lane file may also carry the other fields a node can carry, such as `alternatives`; see
[Node and module fields](./35-node-fields.md).

## Events

Each entry of `events:` places one clip or sequence on the lane. It says **where** it starts, **which
part** of the material plays, and **how many times** — never a length: the length follows from the
material and the window.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `ref` | text, required | — | The clip or sequence id (`clips/<ref>` or `sequences/<ref>`). |
| `start` | position timecode | the start of the song | Where the event starts on the timeline. |
| `from` | seconds or timecode | the material's own start | Where the window opens in the material. See below. |
| `to` | seconds or timecode | the material's own end | Where it closes. When both are numbers, `to` must be greater than `from`. |
| `loop` | whole number ≥ 1 | `1` | How many times the window plays, back to back. |
| `fadeIn` | duration timecode | none | Fade-in length. |
| `fadeOut` | duration timecode | none | Fade-out length. |
| `gain` | number, −6 to 6 | `0` | This event's own trim in dB. Audio events only: a sequence placed with a gain is refused (change its velocities instead). |
| `disabled` | true/false | `false` | Silence this event without removing it. |
| `warp` | true/false | `true` | Whether this event follows its clip's stretch map. |
| `takes` | list | none | Other performances of this event. See below. |
| `comp` | list | none | Which take plays over which span. See below. |
| `crossfades` | list | none | Crossfades at the seams between comp spans. See below. |

### The window: `from` and `to`

The window chooses which part of the material plays. Its unit depends on the material:

- For an **audio clip**, a number is seconds into the source file; a timecode is converted with the
  project's tempo.
- For a **sequence**, use timecodes: positions inside the sequence.

The event's window is intersected with the window the clip or sequence file states itself.

`loop` repeats the window, so it needs to know where the window ends. A clip placed with `loop: 2` or
more must have a `to` on the event or in the clip file, or the project refuses to load with
`clip '…' is placed with loop: 4, but neither it nor the event says 'to'`.

### Takes, comp and crossfades

When a passage has been recorded several times, the event keeps every performance and a **comp**
choosing between them. All three lists are written by k7's takes view; the format is:

```k7x
events([
  ref("vox-take1")
    .start("9:1")
    .takes([ref("vox-take2").start("9:1"), ref("vox-take3").start("9:1")])
    .comp([take("vox-take1").from("9:1").to("11:1"), take("vox-take3").from("11:1").to("13:1")])
    .crossfades([at("11:1").length("0:0:1")]),
])
```

| List | Entry fields | Meaning |
|---|---|---|
| `takes` | `ref` (material id), `start` (position) | Another performance, and the song position its material starts at. |
| `comp` | `take` (a take's ref), `from`, `to` (positions) | Over this span of the **song**, play this take. Spans are in song time, not in the take's own time. |
| `crossfades` | `at` (position), `length` (duration) | A crossfade centred on a seam between spans. |

## Errors you may see

These are reported when the project compiles and stop it from loading until fixed:

| Message | Meaning |
|---|---|
| `track 'x': clip/sequence 'y' not found` | No `clips/y` or `sequences/y` file. |
| `track 'x': clip 'y' failed to load — …` | The file exists but is not valid; the rest of the message says why. |
| `track 'x': audio clip 'y' file missing (…)` | The clip's `source` file is not there. |
| `track 'x': audio clip 'y' names a file outside the project (…)` | The clip's `source` (an absolute path, or one climbing out with `..`) leaves the places a project may read: the project, its workspace, the libraries, and k7's own render and model caches. |
| `track 'x': strudel pattern '…' file missing` | The lane's `strudel:` file does not exist. |
| `track 'x': sequence 'y' is placed with a gain…` | `gain` on a MIDI event. |
| `chain '…': from 'x' is a group — groups carry no signal; name a member track` | A group lane was wired as a source. |
