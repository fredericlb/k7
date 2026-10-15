# Project

## project.yaml

The song header: tempo, rate, meter — plus what the song borrows from outside its own folder.

```yaml schema=ProjectFile
# What this folder IS — the default, so it can be left out. The only other
# value is `z0`, the blind test's own dialect.
#
# The folder's own suffix (`.k7`) is what decides which app opens it, and it
# wins if the two disagree — k7 reports the contradiction rather than picking a side.
# This line is here so the file says it too, which is the only signal there is when
# the workspace IS the project and there is no suffix to read.
type: k7

# What this project DRAWS is not written here at all: it is the `surfaces/`
# folder beside this file, one YAML per screen. A `surfaces/timeline.yaml`
# is what puts an arrangement on screen; a folder without one opens on its
# chains graph, and the transport and the minimap go with the timeline.
#
# A SET adds a `surfaces/desk.yaml` rather than a keyword, and that file
# names the PLAYLIST it plays through. Two decks meeting at a crossfade, a
# set list to play through them, and no timeline. Nothing else marks one.
#
# A `project_type:` line is accepted here and read by nothing: the surfaces
# are what the screen goes by, and a second declaration beside them would
# only be free to disagree with them. A file carrying one still opens — drop
# the line next time you edit it.

project:
  name: my-song
  tempo: 120
  sampleRate: 48000
  timeSignature: "4/4"

  # A summing CONSOLE over the whole mix, Airwindows-style: its channel goes
  # after every lane's strip, its buss first on the master, so the two halves
  # always match. A system is a folder of a library's `console/`. Absent = the
  # lanes sum as they are. `project console <system>` sets it, `none` removes
  # it, and the settings panel's Project tab offers the list.
  console: "@k7-core/console/console-6"

  # Tags the home page shows beside the project, to file songs under. Free
  # words, one tag regardless of case. `project tag <tag>` adds one and
  # `project untag <tag>` removes it; the Tasks panel has both.
  tags: [to mix, live]

  # Nothing here points at the shared folders. A song inherits modules from
  # where they SIT: `../_modules` beside it in the workspace, and the machine's
  # médiathèque. Nearest first, so what is beside the song beats what is global.
  # (Assets are not shared at all — a module carries the files it loads.)
  #
  # `modules_from` and `libraries_from` are accepted, so a song carrying them
  # opens, and read by nothing — k7 says so, and the lines can be deleted.

  # `viewport` and `layers` are the song's PICTURE — the frame its video lanes
  # draw into, and their draw order. See the Video page.
  # `video: true` is accepted and read by nothing: a `surfaces/viewport.yaml`
  # is what draws the frame, and `video_tracks/` is what says there is one.

# Lane order in the timeline, top first. Absent = the order tracks/ is read in.
trackOrder: [drums, bass, melody]

# The soloed lanes — solo as project state, several at once: any entry silences
# every lane not listed. `track solo <lane>` (the timeline's `s`) toggles a name
# in and out, and deletes the line with the last one. Absent = nobody soloed.
# A group's id solos its members; mute stays the lane's own bypass, untouched.
soloed: [drums, bass]

# The highlighted lanes — each heard 10 dB louder, its fader left where it is:
# the strip's +10 button, or `track highlight <lane>`, toggles a name in and out.
# Absent = none.
highlighted: [melody]

# Named positions, for navigation. TIMECODE -> label, and the keys are
# quoted for the usual reason: unquoted, "5:1:1" is a number.
markers:
  "5:1:1": verse
  "13:1:1": chorus
```

## surfaces/&lt;name&gt;.yaml

**Optional, and most projects have none.** A surface is a special view the project asks the
editor to draw — a desk of controls wired to the modules in your chains. One file per surface;
the filename names it, and it becomes a pane in the layout with a button at the top right —
except the viewport, which is a window floating over the panes.

```yaml schema=Surface
# What draws it. `turntables` is the DJ desk: two decks meeting at a crossfade,
# with a channel strip each. The others are `timeline` (the arrangement),
# `viewport` (the frame your video lanes composite onto) and `mastering` (the
# master strip — see below). An unknown one is refused rather than opening onto
# a blank screen.
type: turntables

# Where it goes. `split` means a PANE — a slot in the layout, stacked with the
# others, so the desk sits over your chains rather than covering them. Press its
# number key, or fullscreen it, exactly as you would the timeline. A `viewport`
# says `floating` instead: a window over whichever page is up, which you move by
# its title bar and size by any edge. It is a separate line from `type` because
# where a surface goes and what it is are two questions.
layout: split

# Which songs its browser lists — the PLAYLIST this set draws on. A name under
# `_playlists/` at the root of the workspace, not a path: the folder is fixed.
# Subfolders are kept, so `live/repet` is a playlist filed under `live/`.
#
# This is what puts the twelve songs to hand tonight in front of you rather than
# the two hundred and seventy-nine on the volume. The songs themselves stay in
# the médiathèque; a playlist only names them. Write one in k7, under the cog.
#
# A desk that names none still draws, and says so on its browser — a set list is
# something you choose, not something a project cannot open without.
playlist: ete-2026

# Whether this desk SÉPARE a record it is handed unprepared, so its stem knobs
# have something to subtract.
#
# Put a record on that nobody has prepared and the separation starts there and
# then, with its progress over the four greyed knobs. It plays the whole time —
# an empty stem lane subtracts nothing — and the knobs light up when the files
# land.
#
# WHICH chain separates is not asked here. That is one answer for the whole
# machine, set once in k7's settings (the home page's cog, "Separation
# chains") — or `system stems @k7-core/stems`.
#
# Leave this out and nothing starts, which is deliberate: a separation is
# minutes of arithmetic per song. Prepare a whole set list the night before
# instead, with `playlist stems <playlist>`.
stems: true

# What each of its components moves, in the shape every surface uses: the
# control's id, then the module the CHAINS file names and the param as the
# module's `ui.yaml` binds it.
#
# A component with no line here is not an error in the file — the view says so
# on screen instead, next to the control that cannot do anything:
# « Le composant deckA.eqLow de cette vue n'est pas mappé à un module ».
#
# Required: `crossfade`, and per deck `tempo`, `eqLow`, `eqMid`, `eqHigh` and
# `filter`. Not `transport`, `sync` or `listen` — those are actions, not params.
#
# Offered but not required, per deck: `stemDrums`, `stemBass`, `stemOther` and
# `stemVocals` — the four instruments you can take out of a record. A desk that
# wires none of them is a complete desk and draws no column at all.
mapping:
  crossfade: { module: crossfade, param: Mix }
  deckA.tempo: { module: tempoA, param: Target BPM }
  deckA.eqLow: { module: eqA, param: Low }
```

A `turntables` surface plays a **set**, and its `playlist:` says which one — a playlist in
`_playlists/` at the root of your workspace, written on the Playlists screen under the cog.
That surface is the whole of what makes a project a set: there is no other kind of folder for
one, and no other app that opens it.

The songs themselves stay in the médiathèque. A playlist only names them, which is why the same
one can serve two projects and why fixing a song fixes every set that plays it.

### The mastering strip

A `mastering` surface is a picture of **one module**: a `quick-master` node, drawn as the three
appliances inside it — a three-band compressor, a stereo spreader and a limiter — in the order
the signal goes through them.

```yaml schema=Surface
type: mastering
layout: split

# Ten controls, and every one of them names the SAME module: this surface draws
# one node. Which node is the only thing it cannot work out for itself, since
# you chose that name — so all ten lines are required, and the strip says which
# are missing rather than drawing knobs that do nothing.
#
# The three groups are the three parts: `comp.*` the bands, `spread.*` the
# image, `limiter.*` the ceiling.
#
# The numbers are the module's own — dB, hertz, milliseconds, percent. What the
# slider reads is what the module is set to, so it can be checked against the
# meter in the header.
mapping:
  comp.low: { module: master_qm_1, param: Low Amount }
  comp.mid: { module: master_qm_1, param: Mid Amount }
  comp.high: { module: master_qm_1, param: High Amount }
  comp.lowFreq: { module: master_qm_1, param: Low Freq }
  comp.highFreq: { module: master_qm_1, param: High Freq }
  spread.width: { module: master_qm_1, param: Width }
  spread.bassMono: { module: master_qm_1, param: Bass Mono }
  limiter.drive: { module: master_qm_1, param: Drive }
  limiter.ceiling: { module: master_qm_1, param: Ceiling }
  limiter.release: { module: master_qm_1, param: Release }
```

Make the node first — `node new audio/dynamics/quick-master master_qm_1` against a module that
extends `@engine/quick-master` — put it on the master chain, then
`project surface new mastering master` and fill the ten lines in.

You do not need the surface to use the node: its panel is on the graph like every other module's.
The strip is for when you are working ON the master and want the three parts side by side.

## settings.yaml

Session preferences that belong to the SONG rather than to the machine — what should follow the folder to every device it is synced to. Open-ended: unknown keys are kept, not rejected.

```yaml schema=Settings
metronome: false
metronome_level: 0.6   # how loud the click is, 0.2 … 1
count_in: 1      # bars of click before a recording take starts
```

`count_in` defaults to **1** when the file doesn't mention it; write `count_in: 0` to record immediately.

`metronome_level` defaults to **0.6** and stops at **0.2** — it cannot reach silence, because that is
what `metronome: false` is for. The floor is the audio engine's own, so a smaller number would be
stored and then played at 0.2. The two are separate fields on purpose: switching the click off and
back on brings back the level you had. Right-click the metronome button to set it.

Note that the engine currently rolls **at most two bars**: Tracktion's count-in has three settings — none, one
bar, two bars — so a larger number is accepted and stored, but plays as two.
