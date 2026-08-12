# Picture in l8 — one timeline, two units

A song carries video lanes ([packages/song/docs/picture.md](../../../../packages/song/docs/picture.md)).
This page is the l8 half: where they are drawn, how they are edited, and what the ruler does.

Two surfaces are involved, both `split` (`packages/song/docs/surfaces.md`):

| surface | draws |
|---|---|
| `timeline` | the lanes — audio and picture, one grid, in the pane ring |
| `viewport` | the composited frame, WebGL, against the engine's playhead |

There is **no separate picture timeline**. One grid draws both, and the ruler is what makes that
readable.

## The ruler reads either unit

The clock button in the timeline's header toggles `RulerMode` between `bars` and `seconds`.
Both modes are one function, `rulerTicks`, returning ticks positioned in **beats** — the
surface's only coordinate — each carrying its own label and weight.

| mode | ladder | coarse / medium / fine |
|---|---|---|
| `bars` | a bar halves: bar, beat, half-beat (`subdivideBeats`) | bar · beat · subdivision |
| `seconds` | 1/2/5/10 per decade, then 15s 30s 1m 2m 5m… (`SECOND_TICKS`) | minute · second · fraction |

They are different in KIND, not just in scale: bars halve and time does not. `16s` between
labels is not a duration anyone reads.

The conversion is one number, `bps = tempo / 60`, and it is exact and reversible because there
is one `tempo:` and **no tempo map**. That is the fact the whole feature rests on.

### What the mode changes

- what the ruler prints, and what the grid rules under the lanes
- **what a gesture snaps to.** `bars` — the beat list — is the drawn ticks whichever unit
  produced them, and both the ruler's click-to-seek and a picture drag snap to it. So the
  lines you can see are exactly the positions you can land on, in either reading, and opening
  the zoom is how you reach a finer one.

It changes nothing on disk. It is a per-session view toggle, beside Expand, because which unit
you want depends on what you are doing this minute rather than on what the song is.

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
length would otherwise undo the trim on the next compile — and it is the same write, so it is
not a special case.

A length-0 placement draws dashed and amber at a placeholder width. The browser has not
measured the source, so the honest thing is a shape that says "this is provisional" rather
than a confident rectangle of the wrong size.

### Seconds in, seconds out

The gesture happens on a beat grid and the file says seconds, so the conversion is at the
edges and nowhere in between: `VDrag` thinks in seconds throughout and multiplies by `bps`
only to draw. Re-typing `tempo:` therefore slides the grid under the cut rather than moving
it.

`pxPerSec` and the tick list are captured at the GRAB rather than read live — exactly as the
audio clip drag captures `ppb`. A zoom arriving mid-drag would otherwise re-scale the offset
under the cursor and the shot would slide away from the pointer.

## Not a command, and why

Every audio edit this shell makes is a **command** — `event move <track> <from> <to>`,
dispatched through `@studio/commands`, which owns the verb. A picture placement is not: there
is no verb for one, so `App.applyVideoEdit` reads the lane's file, applies every field of the
gesture to one buffer with `setVideoPlacementField`, and writes it once.

There is no `picture move` in the catalogue to look for. Two consequences follow:

- **no context menu on a picture lane.** The menu is derived from the command catalogue, and
  an empty menu is worse than none.
- **the caret reports no track id on one.** A video lane is not an engine track — no level,
  no arm, no mixer command — so `caretTrackId` is null there and everything downstream
  refuses it without having to know why. `m` still hides the lane, which is what `mute` means
  on picture.

A surgical rewrite, never a re-serialisation: these files carry the comments that document the
format. The edit is keyed by `ref`, so a placement that moved in the file between render and
drop is still the one that was grabbed.

**One limit follows from that key**: a source placed *twice on the same lane* has one ref for
two placements, and a drag on either writes the first. The format keys them the same way, so it
is the format's limit and not the component's — the workaround is a second lane, or a second
`clips/` entry naming the same file. Placing one source on several lanes is fine; that is what
the scaffold's own picture-in-picture does.

## The frame follows the engine

`ViewportTab` subscribes to `playing` and `playhead` (two slices, separately — a `s => s`
selector would re-render the pane at ~20 Hz) and feeds them to an `EngineClock`, which
interpolates with a wall clock between frames and announces a discontinuity so the driver can
hard-seek every `<video>`.

`@studio/ui-eyes` knows nothing about any of that: it takes a `SeekingClock`, so the renderer is
independent of where its time comes from.

The scene is rebuilt only when the DOCUMENT changes, never on a playhead frame — it owns a GL
context and a `<video>` per layer.

## The readers strip

For an open `video_tracks/*.yaml`, the editor grows a dock of small `<video>` readers, one per
placement, with **Set From** / **Set To** writing that placement's `source_from` / `length`.
The in-point of a shot is a frame you recognise, not a number you type.

Two sources, deliberately:

- the **times** come from the BUFFER — a trim typed a second ago has no compiled form yet, and
  a strip that waited for one would be a step behind every edit;
- the **file each ref names** comes from the COMPILED document, because only the compiler read
  `clips/<ref>.yaml` to find out.

A ref the compiler has never seen simply has no reader, which is the honest answer rather than
a black rectangle. The buttons edit the same buffer a keystroke does, so autosave writes them
the same way.
