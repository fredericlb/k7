# Takes and the comp

An event can be played several times over: each pass is a TAKE, kept beside the event, and the
COMP says which take is heard over which span of song time. Nothing is ever recorded over: the
choice of the best performance is a line in the lane file, made and unmade by a command.

```yaml
# tracks/gtr.yaml
events:
  - ref: gtr_solo                 # the event's own material — take "1" of the view
    start: "5:1"
    takes:
      - { ref: gtr_5.3_261008T101500, start: "5:3" }   # a pass, and where its first beat lands
      - { ref: gtr_5.1_261008T102210, start: "5:1" }
    comp:
      - { take: gtr_5.3_261008T101500, from: "5:3", to: "6:1" }
      - { take: gtr_5.1_261008T102210, from: "7:1", to: "9:1" }
```

## The takes live ON the event, and the comp is compiled away

A take is the event's, not the lane's: it is offered for that event and nowhere else, and it goes
when the event is deleted. So `takes:` and `comp:` are two keys of the placement, beside `ref`. A
lane's alternatives (`alternatives.md`) were the other candidate and were refused: an alternative is
the WHOLE arrangement, so it can only swap the whole event, never a span of it.

The engine never hears of a take. `compClips.ts` turns a comped event into ordinary clips — the
event's own material and its takes, each SLICED to the spans the comp gives it — so the engine plays
a comp with the same code it plays any clip with, and a comp is undone by deleting two keys.

What a reader gets wrong: `comp:` spans are SONG positions, not windows into a take. A take carries
its own `start`, and the slice reads its material from `span.from − take.start`. The placement's own
`from`/`to` are window edges into its material; the comp's `from`/`to` are where in the song.

- **The event's own material is a take like the others.** Picking it for a span REMOVES the spans
  over it rather than writing one: what no span covers plays the event's own (`setCompSpan`).
- **A span that reaches past the event's end extends it.** The event's extent is its own material
  plus every span; nothing else has to change, which is why a placement still states no length.
- **A span reaching before a take's first beat is cut there**: a take has nothing before it.
- **A looped event takes no comp.** It is one window repeated, so there is no single span of it a
  take could stand in for; its `comp:` is ignored until the loop is gone.
- **A seam is a hard cut** unless it is crossfaded (below): a seam on a loud note can click.
- **A warped clip plays its pieces unwarped.** A stretch map is laid on the whole clip's timeline, and
  a slice of it would place the wrong beats.

## Crossfades at the seams

`crossfades:` lists the seams that are crossfaded, each a song position and a duration. At such a
seam the outgoing piece runs half the length past it and the incoming one starts half the length
before it, each fading over the overlap with the equal-power curve (`seamCrossfades`). A crossfade
is clamped to what both takes have on either side of the seam; one that does not fall on a seam of
the CURRENT comp is kept and plays nothing, so re-picking a take does not lose it.

The event's own fades stay on its two ends — the first piece's fade-in, the last one's fade-out.

## A comp never starts before its event

A span is cut at the event's start when it is written (`setCompAt`): a comped event begins where its
placement does. That is what lets every surface show it as one clip addressed by that start, and what
a take recorded from a bar early does — it is heard from the event on, and kept whole on disk.
Moving the event moves its takes, comp and crossfades with it; they are song positions.

## Recording a take: the event is armed, the lane is not muted

`event take arm <track> <at> <from> [to]` tells the file service that this session's next take goes
INTO that event (`takeArm.ts`, session state, never a file). Two things follow, both in the file
service rather than the engine:

- **The take lands in the event.** When the engine reports a finished take on that lane, it is
  declared as a clip like any recording, then added to `takes:` and comped in over what was played —
  the punch if there was one, else from where it started to where it stopped (`addTakeToEvent`).
- **The old performance is heard around the punch, never under it.** The document the engine is
  sent has the punch CUT OUT of the lane (`cutHole`, the same slice the comp uses), and carries
  `recordMute: false`, so the engine does not mute the armed track as it does for an ordinary take.

The punch is not the engine's: a take records the whole pass, and only its comp span is heard. A
span widened later reaches what was played around it, which a punch the engine enforced would have
thrown away.

A MIDI take is the BROWSER's, as every MIDI recording is (`midiIn.md`): the pass, in song beats, is
sent as `event take midi`, written as a sequence of its own and added the same way.

The lane is armed the way its own button arms it: an audio lane in the ENGINE (`transport arm`), a
lane holding a sequence in the BROWSER (`rec`). Both are toggles, so the button arms only a lane that
is not armed, and puts back exactly what it switched when the take stops. The view re-reads the
project twice in the seconds after the stop, and a take row retries a file it cannot read yet, since
an audio take is filed after the stop — the take shows where it was recorded, with no reopen.

The browser disarms a few seconds AFTER the stop, not at it: the engine files an audio take after the
transport stops, and an event disarmed first would see its take land on the lane instead.

## The view

The waveform panel and the piano roll each have a `takes` mode (`ui wave takes`, `ui roll takes`):
one row per take, the event's own first, on one song-time axis. A drag selects a span; a click on a
row with a span runs `event comp` for it, without one it moves the playhead; a row's ✓ picks it over
the span or, with none, wherever it was recorded. A MIDI event takes no span: a click on a row picks that take
WHOLE. Notes swept from several takes would make the event's piano roll a patchwork of sequences
to edit at once, and a part played again is judged as a whole far more often than bar by bar. Its own ● arms the event, arms the lane and turns
record on where they were not, and rolls from the START of what it re-records: the span's when there
is one, punched into it, else the event's own. Not from the playhead: a take is a part played again,
from its top, and the count-in rolls in the bars BEFORE that start — Tracktion puts its pre-roll
ahead of the play position. A MIDI pass turns the engine's record on for the same reason: that is
what counts in, though the notes are the browser's. See `apps/k7/frontend/docs/clipEditors.md`.
