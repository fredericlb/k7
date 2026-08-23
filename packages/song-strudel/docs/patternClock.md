# patternClock.ts — extended notes

Streams Strudel patterns live onto engine tracks, locked to the transport: a look-ahead
scheduler that reads the engine's (interpolated) playhead, queries each pattern for the
upcoming window, and schedules the events just ahead. Timing is sample-accurate — notes
and clips are timeline-scheduled at absolute beats; the clock just delivers them a
little ahead of the playhead.

Each event is routed by its sound (`s`):

- a project instrument module → MIDI notes on a track using THAT plugin (a VST)
- a resolvable sample name → one-shot audio clips (see samples.ts)
- anything else (synth/unknown) → MIDI notes on a default 4OSC track

A pattern reaches the clock because a GROUP track links it (`strudel: "algo/…"`); the
tracks it spawns join that group, so they nest under it on every surface. Orbit/
instrument tracks are appended after the song's own tracks, on the same transport.

While active, the clock is the SOLE sender to the engine (base project + its tracks); a
pass-through when no group links a pattern. Played clips are pruned as the playhead
passes them; with the engine's `ClipRemoved` they're removed there too.

## `switchTo`

Everything the clock tracks is derived from the OLD project — its orbit track defs, the
clips still queued on them, and how far ahead it had already scheduled — so it must be
cleared before the new project's doc arrives. The engine is flushed on the same switch
and its playhead restarts at 0; a `scheduledCycle` left over from the old song would sit
ahead of that, and `tick` would then find nothing left to schedule and go silent for
good. A no-op unless the directory actually changed, so a plain reload (an edit, a
finished take) keeps its live clips.

## `refreshPatterns`

`hadPatterns` guards a redundant send: `emit()` only produces something OTHER than
plain `base` while patterns are active. With no patterns before OR after, the emit
would re-send `base` verbatim — which the caller's `setBaseProject()` just sent.

## `resolve` — how an event lands on a track

A `.label("kick")` matching a `type: "strudel"` track's name lands the event on THAT
track — a compiled lane with a stable id, its own chain and its own mixer strip.
Everything else keeps the old behaviour: a live track the clock mints, keyed by label or
by orbit/sound, scoped to the pattern it came from.

**A declared lane is read exactly like an undeclared one**: the EVENT's sound says what it is. A
name that resolves to a sample IS a sample; anything else is a waveform and plays as a note for
whatever instrument the lane's chain provides.

It used to be the lane's `contentType` that settled this — `s` was a sample name on an audio lane
and a waveform on a sequences one — so a pattern and the lane it was declared on could not
disagree. A detyped lane has no such word to hold them to (see @studio/song's
docs/trackModules.md), and does not need one: one pattern lane can now be half drums and half
melody, which is what a pattern usually is.

Which of the lane's engine tracks the event lands on is `laneHalf`. A lane compiles to one track,
or to two when its `audio` and `midi` outputs were wired separately — and `TrackDoc.contentType`
already says which takes what, with a bare-wired lane saying `"audio notes"` and meaning either.
So the base document answers it and the clock needed no new field.

A lane whose other output is not wired has nowhere to put the event, and that is LOGGED once per
sound rather than dropped: silence with a graph that looks right is the hardest kind to chase. The
message names the key to add.

## `claim` — undeclared live tracks

Picks the id of the live track an UNDECLARED event lands on, registering its def on
first use. A labelled event claims `lbl-<slug>` and names the lane after the label; an
unlabelled one keeps the orbit/sound key and its generated name. Ids are scoped by the
pattern, so two files can each have an unclaimed "lead".

A label claims a live track only while its content type agrees — reusing one label for both a
sample and an instrument would otherwise pile audio clips onto a notes track, so the odd
one out falls back to its orbit key and keeps playing under the generated name. This is about the
tracks the clock MINTS, which are typed because it types them; a declared lane is not, and takes
both by wiring both outputs.

## `emit`

The doc the engine gets: the compiled project with its declared strudel lanes' clips
filled in, plus a live track per undeclared lane appended after. A declared lane is
MERGED, not appended — it is already in `base.tracks` with the plugins its chain
compiled, its mixer settings and its group, so only its clips come from here. Appending
would give the engine two tracks sharing one id.

### …and it sends the LANES, not the song

Everything but the strudel lanes is `base.tracks` verbatim, tick after tick — the same objects —
while the engine was handed the whole document to be told about eight notes: 137 KB against 3.7
on a real project, plus a parse and a diff that rebuilds four maps over every track, clip and
plugin in it. So a tick sends `tracks` (`engine/moteur/docs/protocol.md`), which replaces those
lanes in the document the engine already holds.

The guard is the TRACK SET, not the content. A delta replaces by id and can neither add nor
remove, so it is only honest while the ids are the ones the engine was last given, and while the
base is the same OBJECT — anything else in the song moving is exactly what a delta cannot carry.
Either changes and the whole document goes out instead, and is remembered as the new baseline.

Two more ways the baseline is dropped, both deliberate. `setBaseProject` is a fresh compile, so
it always sends a document. And `forgetSent()` is called when the engine socket opens: a fresh
socket can mean a fresh engine holding nothing, and a delta aimed at a document that is not there
would be a lane that never sounds with no error anywhere.

The delta channel is an OPTIONAL fourth constructor argument. A caller that wires none — the CLI,
a test — keeps getting whole documents, which is what this did before and what still has to work.
