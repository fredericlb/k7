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

A declared lane's `contentType` settles how the event reads, so the pattern and the
track's chain can't disagree about it: `s` is a sample name on an audio lane and a synth
waveform on a sequences one — never an instrument module, since the chain owns that
lane's plugins (see `#StrudelTrack` in graph.ts).

## `claim` — undeclared live tracks

Picks the id of the live track an UNDECLARED event lands on, registering its def on
first use. A labelled event claims `lbl-<slug>` and names the lane after the label; an
unlabelled one keeps the orbit/sound key and its generated name. Ids are scoped by the
pattern, so two files can each have an unclaimed "lead".

A label claims a lane only while its content type agrees — reusing one label for both a
sample and an instrument would otherwise pile audio clips onto a notes track, so the odd
one out falls back to its orbit key and keeps playing under the generated name.

## `emit`

The doc the engine gets: the compiled project with its declared strudel lanes' clips
filled in, plus a live track per undeclared lane appended after. A declared lane is
MERGED, not appended — it is already in `base.tracks` with the plugins its chain
compiled, its mixer settings and its group, so only its clips come from here. Appending
would give the engine two tracks sharing one id.
