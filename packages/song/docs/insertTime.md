# Inserting and removing song time

`project add <at> <length>` opens a span of time; `project remove <at> <length>` closes one.
Everything after the point moves. From the timeline the caret answers `at`, so it reads as "insert
two bars here"; the argument is declared anyway, which keeps the verb usable from a terminal.

`at` is a **position** and `length` a **duration**. Both are legal timecodes and nothing
downstream can tell them apart, which is why every page that touches this pair says so.

## What moves, and what does not

The whole feature is this table. A field positioned in song time that is missing from the left
column is a field that silently drifts out of step with the rest of the song.

| moves | where | unit |
|---|---|---|
| a lane's events | `nodes/<id>.yaml` `events[].start` | timecode |
| …and every alternative's own events | `alternatives[].events[].start` | timecode |
| markers | `project.yaml` `markers` **keys** | timecode |
| a drawn curve's points | `curves/<id>.yaml` `points[].time` | timecode |
| picture | `video_tracks/<id>.yaml` `events[].start` | **seconds** |

| stays | why |
|---|---|
| `fadeIn` / `fadeOut` | a **duration** that happens to be spelled as a timecode — the single easiest field in the model to shift by mistake |
| a placement's and a material's `from` / `to` | a window into the MATERIAL, not a place on the timeline |
| a sequence's `notes[].t` / `.d` | beats relative to the sequence |
| warp markers | clip-relative, and shared by every placement of the clip |
| onsets | seconds into the source file |
| an LFO's `frequency`, an ADSR's stages | cycles per bar; milliseconds. Neither is positioned |

An **LFO survives untouched**, and that is right — it is periodic, not placed. What does change is
its phase relative to everything after the cut. That is a fact about music rather than a bug, and
there is nothing to write.

## Alternatives need their own writer

Every placement writer in the repo goes through `eventsToEdit`, which answers "where does an edit
to what is PLAYING go" — the selected alternative's list, and nothing else.

That is correct for an edit and wrong for this. Inserting time is not a change to the arrangement,
it is a change to the song's **clock**: an alternative you switch to has to still line up with the
markers. So `spliceTime` walks `everyEventList` — the playing events and every alternative's own
events — rather than asking where one edit belongs.

## All the files, or none

A splice rewrites every lane, curve and video lane and `project.yaml`'s markers. Every new text is
made first and only then written, so a file that cannot be transformed (its YAML broken) throws
before anything reaches the disk. Written one by one, a throw on the fifth file would leave the first
four shifted and the rest not: a song whose lanes disagree about where bar 9 is, which no undo knows
how to take back.

## A straddling event is decided by its START

An event whose start is at or after the point moves. One already playing **across** the point stays
where it is and plays over the inserted silence.

It is the house rule: `moveTrackPlacementsInRange` and `selection consolidate` both select by
where a placement starts, both ends inclusive, with a `1e-6` epsilon. It is the house answer to
"what is in this range".

The alternative — cutting the event at the point and moving its tail — is what a conventional DAW
does, and it would make inserting time a verb that **writes new material and renders audio**.
[materialCut.md](materialCut.md) is explicit that there is no free, exactly-reversible cut here:
splitting writes two materials, rejoining writes a third, and the cut material stays on disk.
A clock change should not do that.

`project remove` follows from the same rule: events that **start** inside the span are removed, and
everything from the far edge onwards comes back by the span's length.

## The round trip is the proof

Insert a span, delete the same span, and the project is **byte for byte** what it was.

That one assertion catches what a field-by-field test would need a case each for: a shift applied
twice, a spelling that drifts, a key that gains or loses quotes on the way out, a rounding that
accumulates, and a kind of thing that moves one way and not back. It is `insertTime.test.ts`'s
last describe, and it is the reason to trust the rest.

One allowance, stated there: the writers spell a position canonically, so a hand-written `"5:1:1"`
comes back as `"5:1"`. That is a normalisation and it happens **once** — the round trip is asserted
from a settled file, because demanding byte-equality against hand-written text would be asserting
that the writers preserve input spelling, which they do not and should not.

## Two places a timecode has to be quoted

**A marker key.** Unquoted, `2:1:1` is a YAML 1.1 sexagesimal integer, so `writeMarkers` goes
through `setQuotedKeyMap` — and so does `project marker new`. Neither of the general writers can
do it: `setFileValue` gives every key the plain style, and `quoteTimecodes` walks **values** under
known keys, so neither sees a timecode used as a **key**.

**A curve point's `time`.** It is in `TIMECODE_KEYS`, the set every writer quotes through — the one
other place a timecode is written by a tool.

## The picture entorse

`applyVideoEdit` states plainly that the CLI has no verb for a picture placement and that the
frontend writes the file directly. This verb is the **one exception**, and it is a decision
rather than an oversight: a change to the song's clock cannot leave picture behind, or a shot and
its sound drift apart the moment a bar is inserted.

Two details it costs:

- Picture is **decimal seconds**. The conversion is `beats × 60 / tempo`, exact because there is
  one tempo and no tempo map — the one place that absence is a simplification rather than a limit.
- `setVideoPlacementField` addresses **by ref**, which is right for the editor's per-placement
  readers (they found the placement by its source in the first place) and wrong here: a ref may
  appear twice on a lane, and both must move. So `spliceVideoTime` addresses by index, as the
  timeline's own drag does.

## Placing a point

`spliceCurveTime` moves points wholesale; placing one is `curve point add|move|remove` — see
[curves.md](curves.md). The two share the same address (a moment) and the same collision rule
(one moment, one value), which is what lets a splice and an edit be applied in either order.
