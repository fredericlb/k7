# Project

## project.yaml

The song header: tempo, rate, meter — plus what the song borrows from outside its own folder, and the video fields for a song with picture.

```yaml schema=ProjectFile
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

  # optional picture:
  # video: true
  # viewport: [1280, 720, 30]   # [w, h, fps]
  # layers: [main, pip]         # draw order, bottom first

# Lane order in the timeline, top first. Absent = the order tracks/ is read in.
trackOrder: [drums, bass, melody]

# Named positions, for navigation. TIMECODE -> label, and the keys are
# quoted for the usual reason: unquoted, "5:1:1" is a number.
markers:
  "5:1:1": verse
  "13:1:1": chorus
```

## settings.yaml

Session preferences that belong to the SONG rather than to the machine — what should follow the folder into git. Open-ended: unknown keys are kept, not rejected.

```yaml schema=Settings
metronome: false
count_in: 4      # bars of click before a recording take starts
```

`count_in` defaults to **4** when the file doesn't mention it; write `count_in: 0` to record immediately.

Note that the engine currently rolls **at most two bars**: Tracktion's count-in has three settings — none, one
bar, two bars — so a larger number is accepted and stored, but plays as two.
