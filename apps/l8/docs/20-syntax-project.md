# Project

## project.yaml

The song header: tempo, rate, meter — plus what the song borrows from outside its own folder.

```yaml schema=ProjectFile
# What this folder IS — the default, and what every project written before this
# line existed is, so it can be left out. The only other value is `z0`, the
# blind test's own dialect.
#
# The folder's own suffix (`.l8`) is what decides which app opens it, and it
# wins if the two disagree — l8 reports the contradiction rather than picking a side.
# This line is here so the file says it too, which is the only signal left when the
# repository IS the project and there is no suffix to read.
type: l8

# What this project DRAWS is not written here at all: it is the `surfaces/`
# folder beside this file, one YAML per screen. A `surfaces/timeline.yaml`
# is what puts an arrangement on screen; a folder without one opens on its
# chains graph, and the transport and the minimap go with the timeline.
#
# A SET adds two files rather than a keyword: a `songs.yaml` and a
# `surfaces/desk.yaml`. Two decks meeting at a crossfade, a list to play
# through them, and no timeline. Nothing else distinguishes one.
#
# There used to be a `project_type:` line here saying `arrangement` or
# `live`. It is gone: it was a second declaration free to disagree with the
# surfaces, and the surfaces are what the screen actually reads. A file that
# still carries the line still opens; nothing looks at it, and you can drop
# it next time you edit.

project:
  name: my-song
  tempo: 120
  sampleRate: 48000
  timeSignature: "4/4"

  # Nothing here points at the shared folders. A song inherits modules from
  # where they SIT: `../_modules` beside it in the workspace, and the machine's
  # médiathèque. Nearest first, so what is beside the song beats what is global.
  # (Assets are not shared at all — a module carries the files it loads.)
  #
  # `modules_from` and `libraries_from` used to list them. They are still
  # accepted so older songs open, and read by nothing — l8 says so and
  # the lines can be deleted.

  # `viewport` and `layers` are the song's PICTURE — the frame its video lanes
  # draw into, and their draw order. See the Video page.
  # `video: true` is still accepted and read by nothing: a `surfaces/viewport.yaml`
  # is what draws the frame now, and `video_tracks/` is what says there is one.

# Lane order in the timeline, top first. Absent = the order tracks/ is read in.
trackOrder: [drums, bass, melody]

# The soloed lanes — solo as project state, several at once: any entry silences
# every lane not listed. `track solo <lane>` (the timeline's `s`) toggles a name
# in and out, and deletes the line with the last one. Absent = nobody soloed.
# A group's id solos its members; mute stays the lane's own bypass, untouched.
soloed: [drums, bass]

# Named positions, for navigation. TIMECODE -> label, and the keys are
# quoted for the usual reason: unquoted, "5:1:1" is a number.
markers:
  "5:1:1": verse
  "13:1:1": chorus
```

## surfaces/&lt;name&gt;.yaml

**Optional, and most projects have none.** A surface is a special view the project asks the
editor to draw — a desk of controls wired to the modules in your chains. One file per surface;
the filename names it, and it gets a button at the top right of the screen.

```yaml schema=Surface
# What draws it. `turntables` is the DJ desk: two decks meeting at a crossfade,
# with a channel strip each. The others are `timeline` (the arrangement) and
# `viewport` (the frame your video lanes composite onto). An unknown one is
# refused rather than opening onto a blank screen.
type: turntables

# Where it goes. `view` means a screen of its own, reached from the header —
# the only layout so far. It is a separate line from `type` because the same
# desk could one day be a panel instead.
layout: view

# What each of its components moves. Same shape as `views/mix.yaml`: the
# control's id, then the module the CHAINS file names and the param as the
# module's `ui.yaml` binds it.
#
# A component with no line here is not an error in the file — the view says so
# on screen instead, next to the control that cannot do anything:
# « Le composant deckA.eqLow de cette vue n'est pas mappé à un module ».
#
# Required: `crossfade`, and per deck `tempo`, `eqLow`, `eqMid`, `eqHigh` and
# `filter`. Not `transport`, `sync` or `listen` — those are actions, not params.
mapping:
  crossfade: { module: crossfade, param: Mix }
  deckA.tempo: { module: tempoA, param: Target BPM }
  deckA.eqLow: { module: eqA, param: Low }
```

A `turntables` surface plays a **set**: a `songs.yaml` at the project root naming médiathèque
songs. That file and this surface are the whole of what makes a project a set — there is no
other kind of folder for one, and no other app that opens it.

## settings.yaml

Session preferences that belong to the SONG rather than to the machine — what should follow the folder into git. Open-ended: unknown keys are kept, not rejected.

```yaml schema=Settings
metronome: false
count_in: 1      # bars of click before a recording take starts
```

`count_in` defaults to **1** when the file doesn't mention it; write `count_in: 0` to record immediately.

Note that the engine currently rolls **at most two bars**: Tracktion's count-in has three settings — none, one
bar, two bars — so a larger number is accepted and stored, but plays as two.
