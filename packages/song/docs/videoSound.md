# A shot's sound — the picture lane's own `#audio` half

```k7x
// nodes/main.k7x — a picture lane, and its sound with it
extends("@meta/picture-track")
events([
  ref("shot_a").start(0).length(4),
  ref("shot_b").start(4).length(2).speed(0.5).pitch("keep"), // slow motion, voice at its own pitch
])

// clips/shot_a.k7x
source("clips/shot_a.mp4")
sound("clips/shot_a.sound.wav") // extracted once, by `picture sound`

// graph.k7x — wired, or not at all: an unwired `main#audio` plays to the mix
modules({ "main#audio": ["dialog-eq"], "dialog-eq": ["MIX"] })
```

A picture lane offers two outputs: `video`, what it draws, and `audio`, what its shots sound.
`src/videoSound.ts` turns the shots into the engine clips of that second half at compile time, and
`nodeProject.ts` plays them as the engine track `main#audio`. `picture sound`
(`packages/commands/src/verbs/pictureSound.ts`) extracts what the shots need and makes nothing else.

## One lane, two halves

The shot and its sound are one thing on one lane: moving, trimming or cutting a shot moves its sound,
with no second set of positions kept in step by hand. A picture lane is not typed by a material the
way a sound lane is not, but it IS two signals, so it is two halves:

- **The picture half** is the lane itself. Its mute HIDES it (`bypassed: ["main"]`), its solo is the
  picture's, and its runs to RENDER are its bare `main:` entries.
- **The sound half** is `main#audio`, with its own mute (`bypassed: ["main#audio"]`), solo, highlight
  and strip. Hiding a shot does not silence it, and silencing a lane's sound does not hide it — the
  two are asked for separately, so they are said separately.

A sound half is a TRACK and not a node: the graph holds it only when it is wired, so its bypass is
an entry of the list that no node need hold (`setBypassEntry`). Unwired, it plays straight to MIX,
as a sound lane wired to nothing does: dropping a video gives its sound with no step to take.

The engine track is named `main#audio` whatever the chain leaving it is called, so its strip keeps
its name when the graph changes shape. A lane none of whose shots sounds, and whose `#audio` is wired
to nothing, compiles no track at all — a strip that plays nothing is a strip to delete by hand.

## A chain project keeps a sounding lane

A chain project spells no port: a lane is one item heading one chain, and nothing there can say
"`main#audio` goes through this EQ". So in a chain project the sound is still an audio lane naming
the picture lane, `video_source("main")`, which `picture sound` makes. Its events ARE the shots: it
states none of its own, and the two together are refused, since they would be two sets of positions
for one material. A picture lane a `video_source:` lane sounds plays no `#audio` half, so nothing is
heard twice.

A node project's open folds such a lane into its picture lane (`src/pictureSoundMigrate.ts`): its
chain leaves `main#audio`, its mute, solo and highlight become the half's, its row goes, and the
project is written at format level 4. A picture lane two lanes sound is left as it is and named:
merging two strips is a choice, not a migration.

## The ENGINE plays it, not the `<video>`

The picture's `<video>` elements are muted and stay muted (`packages/ui-eyes/docs/realtime.md`).
A shot's sound goes through the engine like every other sound in the song, for three reasons:

- **One clock.** The engine's transport is the authority the picture already chases. A second
  audio clock in the browser would drift against the song's own lanes, and that drift is audible
  long before a picture's is visible.
- **The mixer.** A dialogue needs a fader, an EQ, a send. A sound half has them all; a `<video>`'s
  volume is one number outside the graph.
- **The render.** The export muxes the ENGINE's mixdown (`packages/ui-eyes/src/export.ts`), so
  sound the engine never played would be missing from every file the song produces.

## The sound is an extracted WAV, never the container

The engine reads clips through Tracktion's format manager. It opens a video container only
through the platform's decoder: CoreAudio on macOS, Media Foundation on Windows. On Linux and
Android it opens none. The server's own engine is a Linux container (`docs/server-engine.md`) and
the phone is Android, so a clip pointing the engine at an `.mp4` would play on a desktop and be
silent on both of those, without an error that says why.

So the sound is decoded ONCE, into a float WAV beside the video, and that is what the engine is
handed. `@studio/audio-analysis`'s `extractSound` does it with **ffmpeg first**, because a
browser's own recordings are WebM, which neither CoreAudio nor Media Foundation reads. The
engine's `--decode` is the fallback, for a desktop with no ffmpeg (`packages/audio-analysis/docs/analysis.md`).

## `sound:` is written on the clip, not derived from its name

The compile reads `sound:` and never guesses a path from `source:`. A file renamed or replaced by
hand, such as a cleaner mix of the same take, is then one line to change. A clip with no `sound:`
is **silent and says nothing**: a film with no soundtrack is a legitimate film. A `sound:` naming
a file that is not there is **refused**, as a missing audio clip is, because the engine would
otherwise play silence where the file says there is sound.

`picture sound` writes it as `<stem>.sound.wav`, so it cannot land on an audio clip of the same
stem that was already there.

## The shot is what an edit moves

The sound's clips are the shots, so the `event …` verbs refuse the sound — `main#audio`, or a
sounding lane — once, at dispatch (`soundingLaneRefusal` in `runCommand`), and name the `picture`
verb to use: the shot is what an edit moves, and its sound follows.

Removing is the exception. Deleting a clip of that sound is how a person says "not this shot's
sound", so `event remove` and `events remove` do not refuse it: they set `silent: true` on the shot
that clip is the sound of, found by the compile's own rule (`videoSoundPieces`). The picture keeps
the shot. `picture silence <lane> <at>` is the same flag as a toggle, and the way back.

## A silent shot still covers

`silent` takes a shot's sound away, not the shot. A silent shot cuts the sound of the shots under
it exactly as a heard one does, because the picture does not show them there either. Hearing the
earlier shot through it would be sound with no picture.

## Heard where it is seen

The sound follows the picture's own rule (`packages/ui-eyes/src/timeline.ts`), not a separate
audio rule:

- A shot ends at its `length`, else at the next shot's `start`, else at the end of its file.
- The shot later in the file covers the ones before it. An earlier shot is cut where a later one
  covers it and is heard again after it, exactly as it shows again.
- The incoming shot's `fadeIn` IS the transition. The outgoing sound runs through it and fades
  out over the same span, and that pair is what `markCrossfades` marks equal-power.
- An ACTIVATION, an event with no `ref`, covers nothing and sounds nothing.

A dissolve's `with:` and `chain:` change only the picture. The sound has one way to cross.

## Seconds in the file, beats on the wire

The engine's clips are in beats, and the shots are in seconds against one `tempo:` with no tempo
map (`packages/song-video/docs/picture.md`). The conversion happens in the compile, every time, so
re-typing `tempo:` leaves the sound under its shot. A sounding clip of a shot at its own pace carries
no warp map: the material answers to the clock, not to the tempo.

## A retimed shot: tape by default, its pitch when asked

A shot's `speed` ([../../song-video/docs/speed.md](../../song-video/docs/speed.md)) reaches its sound
as a two-marker warp: one second of song spends `speed` seconds of sound.

- **`tape`, the default**, is a `varispeed` warp: RESAMPLED, so the pitch follows the speed — half
  speed an octave down. It is what the picture does, a rate and nothing else, and it is the honest
  sound of a retimed film.
- **`pitch("keep")`** asks for the engine's stretcher instead (`elastique`, which the engine runs as
  élastique where it is built and SoundTouch where not): the shot's sound takes the same time at its
  own pitch. Speech in slow motion stays intelligible, at the price of a processed sound — which is
  why it is a choice per shot rather than the rule.

The engine has no reverse playback: a warp map only runs forwards, and nothing in it reverses a
clip. A reversed shot is therefore silent, and so is a freeze, which has no sound to hold, whatever
its `pitch`. Both stay in the picture's covering rule, so the sound under them is still cut where
they start.
