# Picture in st0 — one timeline, two units

A song carries video lanes ([packages/song-video/docs/picture.md](../../../../packages/song-video/docs/picture.md)).
This page is the st0 half: where they are drawn, how they are edited, and what the ruler does.

Two surfaces are involved (`packages/song/docs/surfaces.md`):

| surface | layout | draws |
|---|---|---|
| `timeline` | `split` | the lanes — audio and picture, one grid, in the pane ring |
| `viewport` | `floating` | the composited frame, WebGL, against the engine's playhead |

The frame is a WINDOW over the pages rather than one of them, so the lanes, the graph and the
shader that draw it stay on screen while you watch it (`components/FloatingWindow.tsx`). Its place
and size are kept per browser (`src/floatingRect.ts`) rather than in the project: where a window sits
is a habit of one screen, and in the song it would be a diff on every drag.

There is **no separate picture timeline**. One grid draws both, and the ruler is what makes that
readable.

## The picture rows are drawn FRONT FIRST

`layers:` is **bottom-first** — the last name draws last, so it is the one in front. The timeline
lists its picture rows the other way round, topmost layer at the top, which is the ordering every
compositing tool uses and the only one under which "drag this lane to the top" can mean what it
looks like. Ordered the other way, a lane dragged to the top row becomes the FIRST layer, goes
behind the full-frame lane it was over, and disappears — nothing broken, the row order simply
meaning the opposite of the gesture. `rows.test.ts` pins the round trip, from the top row to the
resulting `layers:`.

The reversal is `projectRows`' alone. Nothing downstream re-sorts: the compile hands out
`videoTracks` bottom-first and the compositor draws them in that order
(`packages/ui-eyes/src/compositor.ts`), so the frame is unaffected by how the timeline lists them.

## The ruler reads either unit

The clock button in the timeline's header toggles `RulerMode` between `bars` and `seconds`. Both
modes are one function, `rulerTicks`, returning ticks positioned in **beats** — the surface's
only coordinate — each carrying its own label and weight.

| mode | ladder | coarse / medium / fine |
|---|---|---|
| `bars` | a bar halves: bar, beat, half-beat (`subdivideBeats`) | bar · beat · subdivision |
| `seconds` | 1/2/5/10 per decade, then 15s 30s 1m 2m 5m… (`SECOND_TICKS`) | minute · second · fraction |
| `seconds`, with a picture | 1, 2, 5, 10, 15 FRAMES below a second (`secondTicks(fps)`), then the same | minute · second · frame |

The frame rungs come from the picture's `fps`, which App hands the timeline only when the song
has a picture lane: a song with none has no frame to land on (`packages/ui-timeline/docs/ticks.md`).
They apply to the whole grid and not just to the picture rows, since an audio lane's cut or a hit
point is placed against that same picture.

They are different in KIND, not just in scale: bars halve and time does not. `16s` between labels
is not a duration anyone reads.

The conversion is one number, `bps = tempo / 60`, and it is exact and reversible because there is
one `tempo:` and **no tempo map**. That is the fact the whole feature rests on.

The mode changes what the ruler prints, what the grid rules under the lanes, and **what a gesture
snaps to**: `bars` — the beat list — is the drawn ticks whichever unit produced them, and both
the ruler's click-to-seek and a picture drag snap to it. So the lines you can see are exactly the
positions you can land on, in either reading, and opening the zoom is how you reach a finer one.

It changes nothing on disk. It is a per-session view toggle, beside Expand, because which unit
you want depends on what you are doing this minute rather than on what the song is.

## Mute, solo, and when a lens is open

A picture row carries **M** and **S** where an audio lane carries M/S/A, and `m`/`s` reach them
from the keyboard through the same ordered binding `r` uses — `caret_track` first, then
`caret_picture`, the two lanes' words living in two places.

- **M** is `picture mute`, which on picture means HIDDEN — the lane's own file carries it.
- **S** is `picture solo`, which writes `project.yaml`'s `soloed:` — the SAME list audio uses
  ([packages/song-video/docs/picture.md](../../../../packages/song-video/docs/picture.md)).

`pictureMix.ts` is the fold, and it is one module because two surfaces read it: the frame, which
composites, and the timeline, which dims a row that is off screen. Two copies of "is this lane
showing" is two answers to a question with one.

The third rule in it is the LENS: a camera wired to a lane opens `off` never, `auto` while that
lane is armed, and `on` always
([packages/song/docs/camera.md](../../../../packages/song/docs/camera.md)). A shut lens is dropped
from the scene rather than drawn-and-hidden, so the camera is never opened and its indicator stays
off — which is what `off` has to mean to be worth having.

That is also why `sceneOf` takes the armed lane: `auto` is the one visibility rule keyed on
SESSION state rather than on the document, so arming rebuilds the scene. Arming is a click and
the scene rebuild is the one this pane already pays for a document change — the alternative is a
live channel into the driver for a value that moves twice an hour.

## Recording a lane's input

A picture lane carries an **A** button in its timeline gutter: armed, its input — a webcam, the
only kind there is for now — is captured while the transport rolls, and on stop the take lands in
`clips/` and is placed with `picture add`, so it is one journal entry and one Ctrl+Z like every
other placement.

**The capture is the browser's, top to bottom**, for exactly the reason the lens itself is: the
engine never hears about a camera ([packages/song/docs/camera.md](../../../../packages/song/docs/camera.md)).
`useVideoRecording.ts` is the hook, and `useMidiRecording.ts` beside it is the same shape — the
third kind of arm this app holds, after the ENGINE's (an audio lane) and the browser's (a MIDI
lane). Which is why arming a picture lane is `ui picture arm` and not `transport arm`: nothing is
written and the engine has nothing to be told.

Which camera: the one the lane NAMES if it names one (`camera:`, matched by label, exactly as the
live lens is), otherwise the machine's default. A label that matches nothing falls back and says
which cameras there are — `matchCamera`, the lens's own rule rather than a restatement of it.

### Five things the recording has to get right

- **The start is the playhead when the CAMERA started**, read in `onstart`, not when the key was
  pressed. Opening a lens takes time — a permission prompt takes much more — and a take placed
  where the gesture began would sit that far ahead of its own first frame.
- **The length is measured and written.** `picture add` takes one, and a take that omitted it
  would compile as `length: 0`, "to the end of the source" — a duration the compiler would then
  have to read out of the file.
- **A fresh WebM has no duration in it**, which makes it unseekable, which makes it a clip the
  frame cannot scrub. `fix-webm-duration` repairs the blob before it is uploaded — the same
  library and the same fix the rehearsal recorder applies (`packages/recorder/docs/recorder.md`).
- **The lens is let go** on stop and on unmount. A stream left running keeps the indicator lit and
  the device held until the tab closes.

- **The bytes are on disk while it records**, not in the tab. Each chunk goes to the origin's
  private file system as it arrives ([`../src/takeSpool.ts`](../src/takeSpool.ts)); an hour of
  camera is gigabytes, and held in memory a crash or a killed tab lost all of it. A take an
  interruption left behind is handed back as a download at the next start — only one untouched for
  a minute, since a younger file may be another tab's take still recording. The bitrate is capped
  so an hour is a known size, the tab asks before closing while a take records or files, and each
  take keeps its recorder, stream and spool in its own closure, so a stop followed at once by a new
  take cannot hand one take's stream to the other's stop.

A take with no bytes — a camera that never delivered a frame — files nothing and says so, rather
than placing a clip over an empty file.

## Selecting a layer IN the frame, and dragging its rect

Click the picture and you select the layer under the pointer; it gets a box with eight handles.
Drag the body to move it, drag a handle to resize it, and on release the shell runs
**`picture rect <lane> <x> <y> <w> <h>`** — a command, so one journal entry and one Ctrl+Z, unlike
the three timeline drags below. Escape drops the selection.

What is being dragged is the **lane's** rect, not a placement's. A lane says where in the frame it
draws and its placements say what plays there, so there is one rect per lane however many shots
run through it — which is also why this is the only geometry verb picture has.

`ViewportOverlay` is **HTML over the GL canvas**, the way the chains graph draws HTML nodes over
its cable canvas. A hit test inside the renderer would be a second copy of geometry the document
already states, kept in step by hand with the one the compositor draws from. One number converts
between the two spaces — `box.w / viewport[0]`, off `VideoCanvas`'s letterboxed CSS size — and it
is applied at the edges only: everything in `viewportRect.ts` thinks in viewport px.

### Alt-click reaches the layer behind

A plain click takes the FRONT layer, which is the one you can see. That is right until a project
has two full-frame lanes, which is the first thing that happens after `picture lane new` — and
then the one behind can never be clicked at all. **Alt cycles down the stack** and wraps, so every
layer under the pointer is reachable without a layer list.

### Three limits, each deliberate

- **A lane DRAWING shapes is not selectable.** Its rect is not what it draws by — each shape
  module carries its own geometry — so a box around it would move a number nothing reads.
- **Nothing is clamped to the frame.** A shot may legitimately hang off the edge; refusing that
  would make a pan impossible to author.
- **`MIN_SIDE` is the floor** (16 px). A layer resized to nothing is unclickable, so it could not
  be brought back — the one state a drag must not be able to reach.

## The three drags

A picture placement is dragged with one pointer capture, told apart by where the press landed:

| grab | writes | why |
|---|---|---|
| the body | `start` | move the shot |
| the left edge | `start`, `source_from` **and** `length` | trim the head |
| the right edge | `length` | set the extent |

The left edge writing **three** fields is the interesting one, and each is load-bearing:

- `source_from` moves by the same delta as the head, or the frame under the new edge is not the
  frame that was there before the trim;
- `length` moves by that delta the other way, or the **tail slides** and the gesture is a move
  wearing a trim's clothes.

A `length: 0` placement needs its extent pinned for a second reason on top — the source's own
length would otherwise undo the trim on the next compile — and it is the same write, so it is not
a special case.

A length-0 placement draws dashed and amber at a placeholder width. The browser has not measured
the source, so the honest thing is a shape that says "this is provisional" rather than a
confident rectangle of the wrong size.

### Seconds in, seconds out

The gesture happens on a beat grid and the file says seconds, so the conversion is at the edges
and nowhere in between: `VDrag` thinks in seconds throughout and multiplies by `bps` only to
draw. Re-typing `tempo:` therefore slides the grid under the cut rather than moving it.

`pxPerSec` and the tick list are captured at the GRAB rather than read live — exactly as the
audio clip drag captures `ppb`. A zoom arriving mid-drag would otherwise re-scale the offset
under the cursor and the shot would slide away from the pointer.

### A fourth gesture makes one

The three above move a shot that is already there. Dropping a video file from the desktop onto a
picture lane is what CREATES one: the bytes into `clips/`, a `clips/<id>.yaml` declaring the
source, then `picture add <lane> <ref> <seconds>` — a command, so it is one journal entry and one
Ctrl+Z, unlike the three drags. `apps/st0/frontend/docs/timeline.md` has the whole account; what
matters here is that the position is converted at the timeline's edge, since the verb's dialect is
the lane file's own and the grid is in beats.

## The drag is not a command, but the edit is

Every audio edit this shell makes is a **command** — `event move <track> <from> <to>`, dispatched
through `@studio/commands`, which owns the verb. The picture DRAG is not one, for the reason
every continuous gesture is left out (`shell.md`): a pointer move is not a sentence.
`App.applyVideoEdit` reads the lane's file, applies every field of the gesture to one buffer with
`setVideoPlacementField`, and writes it once.

The same five edits have verbs beside them — `picture move | length | head | delete | add`, in
`packages/commands/docs/picture.md` — which is what buys a context menu on a picture lane, an
entry in the palette, a CLI and an undo entry.

**The caret reports no track id on a picture lane**: a video lane is not an engine track — no
level, no arm, no mixer command — so `caretTrackId` is null there and everything downstream
refuses it without having to know why. `m` still hides the lane, which is what `mute` means on
picture.

A surgical rewrite, never a re-serialisation: these files carry the comments that document the
format. **The drag's edit is keyed by the placement's INDEX** in the lane's `events:`, which is
the only address that is always unique and always there: one source may be placed twice on a
lane, and an ACTIVATION on a lane of shapes names no source at all
(`packages/song-video/docs/shapes.md`). `vt.clips[i]` IS `events[i]` — the compile maps them
one to one and filters nothing — so the row the pointer is over knows the address.

The verbs address a shot by **where it starts** instead, that being what somebody can type, and
land on the same `setVideoPlacementFieldAt`. What they cannot tell apart is two shots starting at
the *same instant* on one lane, and they refuse that pair by name rather than picking.

## The frame follows the engine

`VideoCanvas` feeds an `EngineClock`, which interpolates with a wall clock between frames and
announces a discontinuity so the driver can hard-seek every `<video>`.

**Off a raw store subscription, not through React.** The subscription is an effect that calls
`clock.feed` and returns; neither `ViewportTab` nor `VideoCanvas` renders anything from engine
state. A selector hook on the pane would not save it: splitting `playing` and `playhead` into two
slices looks like it keeps the pane off the 20 Hz path and cannot, since the playhead is the field
that MOVES — the pane and everything under it would commit on every frame to hand a number to an
imperative clock no React output depends on. `timeline.md`'s rule is that live state is drawn by
leaves; when nothing is *drawn* at all, the right leaf is no component. The chains renderer's
cable canvas is the same arrangement, which is why `seedFlows` is deliberately not a hook.

The clock is also fed once when the driver is built, from the store's current snapshot: a fresh
clock knows nothing, and with the transport stopped the next frame can be 250 ms away — long
enough to draw frame 0 of a song parked at 3:20.

`@studio/ui-eyes` knows nothing about any of that: it takes a `SeekingClock`, so the renderer is
independent of where its time comes from. The scene is rebuilt only when the DOCUMENT changes,
never on a playhead frame — it owns a GL context and a `<video>` per layer.

The strip under the frame shows the format always and the **per-lane sync error only while
profiling** (`?profile=1`, `src/profiling.ts` — the same flag that arms the React Profiler): a
5 Hz poll and a 5 Hz re-render, fair for someone looking at it and an instrument measuring itself
for everyone else.

## …and so do the graph's picture cables

A cable ripples while it carries signal, and for sound that comes from the engine's meters. The
engine measures no frame, so nothing on the picture side of the chains graph can ripple off one.

`videoSpans.ts` derives it instead, the way `rackLit.ts` derives a lit pad: when each lane shows a
picture, in seconds, out of the video document the viewport already holds. The graph is handed
those spans and reads the playhead off the engine frame itself, so nothing here re-renders as the
playhead moves. The interval rule is **the compositor's own** — `activeAt` in `@studio/ui-eyes`,
pinned by `videoSpans.test.ts` — so a rippling cable and a black viewport cannot disagree, and a
lane counts only while the transport runs: a paused frame is a held picture, not a travelling one.

The rest is `@studio/ui-chains-react`'s docs/liveCables.md, including why `RENDER` has to be
seeded rather than reached.

## The readers strip

For an open `video_tracks/*.yaml`, the editor grows a dock of small `<video>` readers, one per
placement, with **Set From** / **Set To** writing that placement's `source_from` / `length`. The
in-point of a shot is a frame you recognise, not a number you type.

Two sources, deliberately: the **times** come from the BUFFER, since a trim typed a second ago has
no compiled form yet and a strip that waited for one would be a step behind every edit; the **file
each ref names** comes from the COMPILED document, because only the compiler read `clips/<ref>.yaml`
to find out. A ref the compiler has never seen simply has no reader, which is honest where a black
rectangle is not. The buttons edit the same buffer a keystroke does, so autosave writes them the
same way.

## The frame's shape is chosen on the RENDER node

`project.viewport` is a size in pixels and nothing else — everything that reads it reads pixels.
What is chosen is a RATIO: 16:9 or 9:16 for now, and 1920×1080 / 1080×1920 is what that means
([aspect.ts](../../../../packages/song-schema/src/aspect.ts)).

The RENDER node's card carries the list. Three things hold it together:

- **It reads as a field and writes as a verb.** The current value is put on the card by
  `buildGraph` (`renderCard`), so the menu ticks the right line without asking anyone; but what
  it writes is in `project.yaml`, and the RENDER node has no file — hence `@project:aspect`,
  which runs `project aspect <value>`. Same family as `@rack:` and `@rec:`: an intrinsic that
  TRIGGERS instead of writing a module field.
- **The ticked line is decided by the RATIO, not the size.** A project writing `[1280, 720]` ticks
  16:9 as a `[1920, 1080]` does. A shape on neither list ticks nothing — hand-written 4:3 is
  legal, and ticking the nearest would be a lie.
- **The verb keeps the export fps.** `viewport:` accepts a third element; it does not belong to
  this command, which re-reads and rewrites it.

The two names are spelled twice — in `ASPECTS` and in `RENDER_UI` — because `@studio/ui-chains`
does not see `@studio/song-schema`. The verb REFUSES a name it does not know, so a drift is a
refusal rather than a wrong size written silently.

## Exporting the picture — `project export video`

The command has two halves, and the first word says which one comes out:

```
project export audio wav|mp3                   the mix, rendered by the engine
project export video webm|mp4 [wav|mp3|none]   the picture, rendered here — the sound married in
```

`exportScene` (`@studio/ui-eyes`) renders the viewport frame by frame into that container: the
same compositor as in real time, but frame *n* is second *n/fps* and every source frame is pulled
EXACTLY, so a song always renders the same picture.

**WebM is the default**, VP9 and Opus — the one codec pair every browser encodes. `mp4` is the
word to type when the file is going somewhere that wants an mp4, and it asks the build for an
H.264 and an AAC encoder, which Firefox has only the first of.
[passes.md](../../../../packages/ui-eyes/docs/passes.md) is where that choice is argued;
`ViewportTab` says in the viewport's strip when this build cannot encode what the button sends.

**The sound is married into the same container.** `ExportOptions.audio` takes an `AudioBuffer` —
decoded, not the mixdown's bytes: the engine renders a wav or an mp3, the container wants neither,
and it would have to be decoded here anyway. Taking the decoded buffer keeps the whole question
of formats on the caller's side.

Three things in order, and the order matters:

- **the sound first.** It goes through the engine, and a failure there must not cost a minute of
  already-rendered frames.
- **the track is added before `output.start()`**: a container's tracks are declared once. Then the
  whole buffer is pushed in one go — the muxer interleaves it with the frames itself.
- **the default has SOUND.** A silent film is asked for, `project export video webm none`; this is
  a song's video, and silent would be the surprising answer.

The file is named by the container itself — mediabunny owns both the extension and the MIME type,
and `exportScene` returns them beside the bytes, so the name and the contents cannot drift.

The bare line `project export wav` is REFUSED rather than read as audio: the following word now
says which half comes out, and accepting it would make `project export webm` a mixdown.
[exportArgs.ts](../src/exportArgs.ts) is the reading, and its test is the list of shapes.
