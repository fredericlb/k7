# Plan — a picture lane is a lane

A picture lane is `video_tracks/<id>.k7x` today, an entity of its own beside the audio lanes
(`nodes/<id>.k7x`, or `tracks/<id>.k7x` in a chain project). This plan makes it the same entity:
a node, muted, soloed, ordered and renamed as every lane is. It folds in "mute and order on the
shared lists", which is only clean once the ids share one namespace.

Step 1 of the series is done: an event's `start` takes seconds (`song-schema/docs/timecode.md`).

## Decisions

### 1. A picture lane is a `@meta/track` node whose events name video clips

```k7x
// nodes/main.k7x
extends("@meta/track")
frame([0, 0, 1280, 720]) // where it draws; absent is the whole frame
events([
  ref("shot_a").start(0).length(4),
  ref("shot_b").start(4).from(2.5).fadeIn(0.5),
])
```

No new meta ref: what a lane carries is what its events name (`song/docs/trackModules.md`). A clip
whose `source:` is a video is PICTURE material, and a lane leaves by the port its material fits —
`#video` beside `#audio` and `#midi`. The song compile skips picture material entirely; the
picture compile reads only it. That is the split `song-video/docs/picture.md` already makes
between the two documents, moved from "which folder" to "which material".

**For now a lane holds ONE kind of material**: a lane mixing shots and audio events is refused by
name. Mixing them — a shot's sound leaving by `#audio` on its own lane, replacing `video_source` —
is the next step, and needs its own design (the sound of a retimed shot).

### 2. The shot's fields, spelled like the audio event's where they mean the same thing

| today (`video_tracks/`) | a lane event | why |
|---|---|---|
| `start: 4` | `start(4)` | already seconds (step 1) |
| `source_from: 2.5` | `from(2.5)` | the audio window's `from`, which is already seconds when a number |
| `length: 4` | `length(4)` | shot only: the TIMELINE duration, which `speed` makes differ from the window |
| `fade_in: 0.5` / `{over, with, chain}` | `fadeIn(0.5)` / `fadeIn({over, with, chain})` | a number is seconds, as for `start`; a timecode stays musical, for audio |
| `animate`, `speed`, `effect`, `silent` | same names | shot only |
| no `ref` (an activation) | no `ref` | shot only: `ref` becomes optional, an event with none valid only on a lane of shapes |

`PlacementSchema` becomes the union of both vocabularies; the compile, which knows each ref's
material, refuses an audio-only field on a shot and the reverse, with the field's line.

### 3. The lane's fields

| today | a lane | why |
|---|---|---|
| `x, y, w, h` | `frame([x, y, w, h])` | the camera module's spelling for the same fact |
| `mute: true` | `bypassed:` in `graph.k7x`, `bypass` on the chain item | what every lane's mute is |
| `name` | dropped — the id is the name | as an audio lane; the migration reports a name that differed, since following an id rename through the graph is not safe (below) |
| `color` | `color` | unchanged |

### 4. Order: `trackOrder` for every lane; `layers:` goes

The rows are `trackOrder`, audio and picture lanes interleaved as the author places them. The DRAW
order is derived: the picture lanes in row order, the top row in front — the rule the timeline
already draws by. One list, so a row dragged is a layer restacked, and nothing can disagree.

### 5. One reader: the project is migrated at open, and stamped `format(3)`

Not two readers kept side by side. An open (where `ensureVideoRun` and the seconds stamp already
run) migrates a project that still holds `video_tracks/`:

- each `video_tracks/<id>.k7x` → `nodes/<id>.k7x` (`tracks/` and a `track` item in a chain project);
- `layers:` → the picture lanes' place in `trackOrder`; `mute` → `bypassed:`; `x/y/w/h` → `frame`;
- each timeline's `pictures:` lanes → its `lanes:`;
- an id an audio lane already holds → `<id>-picture`, followed in `soloed:`, `video_source`, every
  timeline and a chain project's items. NOT in a node project's `graph.k7x`: there one name already
  meant both lanes, so the graph keeps it for the audio lane and the migration says so;
- one undo-journal entry for the whole migration, then `format(3)`.

A level-2 build then says "update k7" rather than half-reading the new layout. `createTrackFile`
and `track rename` gain the collision refusal `createVideoTrackFile` already makes.

## What moves (from the inventory)

- **Song compile** (`nodeProject.ts`, `compile/inputs.ts`, `graph.ts`, `graphValidate.ts`,
  `hints.ts`): picture material skipped; a lane's kind (`audio` / `picture`) derived from its events.
- **Picture compile** (`videoProject.ts`, `videoTracks.ts`, `videoChains.ts`): lanes from `lanesOf`
  filtered to picture lanes, draw order from `trackOrder`, mute from `bypassed:`.
- **Verbs**: every `picture …` verb resolves its lane through `laneFileFor` instead of `video_tracks/`
  (`picture.ts`, `pictureLane.ts`, `pictureKeys.ts`, `pictureSpeed.ts`, `pictureSound.ts`,
  `pictureImport.ts`, `timelinePictureCopy.ts`); `picture lane new/rename/delete/order` become
  thin aliases of the `track` verbs.
- **Edits**: `videoTrackFile.ts` writers re-pointed at the lane's events; insert-time loses its
  separate seconds pass, since step 1's `spliceTime` keeps seconds as seconds.
- **Frontend**: rows keep `kind: "video"` (it is how the lane DRAWS), keyed by the one lane id;
  `useVideoEdits.ts` writes `nodes/`; `isVideoTrackFile` goes.
- **Graph view** (`ui-chains`, `graph-model`): a picture lane is a lane card with a `video` output.
- **Fixtures and docs**: `demos/video-demo.k7`, `e2e/fixtures/video-lane.k7`, 29 unit-test files,
  and about 40 doc pages naming `video_tracks/`.

## Order of work

1. **Done:** the union placement (`ref` optional, the shot's keys), the audio compile refusing a
   shot's keys by name, `PICTURE_LANE_LEVEL`, and `migratePictureLanes` — not yet run at open —
   tested over copies of `demos/video-demo.k7` and the e2e fixture.
2. Both compiles reading nodes, with the migration run in their tests.
3. Verbs and edits; then the frontend and the graph view.
4. Fixtures, demos and docs; the e2e suite against the running instance.
