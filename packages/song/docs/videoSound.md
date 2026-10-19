# A shot's sound — an audio lane that follows a picture lane

```k7x
// nodes/dialog.k7x
extends("@meta/track")
video_source("main") // the picture lane whose shots this lane sounds

// clips/shot_a.k7x
source("clips/shot_a.mp4")
sound("clips/shot_a.sound.wav") // extracted once, by `picture sound`
```

`src/videoSound.ts` turns the shots of `video_tracks/main.k7x` into this lane's clips at compile
time. The verb that sets it up is `picture sound` (`packages/commands/src/verbs/pictureSound.ts`).

## The ENGINE plays it, not the `<video>`

The picture's `<video>` elements are muted and stay muted (`packages/ui-eyes/docs/realtime.md`).
A shot's sound goes through the engine like every other sound in the song, for three reasons:

- **One clock.** The engine's transport is the authority the picture already chases. A second
  audio clock in the browser would drift against the song's own lanes, and that drift is audible
  long before a picture's is visible.
- **The mixer.** A dialogue track needs a fader, an EQ, a send. An ordinary audio lane has them
  all; a `<video>`'s volume is one number outside the graph.
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

## The lane states no events, and the two together are refused

A sounding lane's positions come from the picture lane. Events of its own would be a second set
of positions for the same material, kept in step by hand, which is the drift this exists to
remove. The compile refuses the pair by name. The `event …` verbs refuse a sounding lane too,
once, at dispatch (`soundingLaneRefusal` in `runCommand`), and name the `picture` verb to use: the
shot is what an edit moves, and its sound follows.

## Heard where it is seen

The sound follows the picture's own rule (`packages/ui-eyes/src/timeline.ts`), not a separate
audio rule:

- A shot ends at its `length`, else at the next shot's `start`, else at the end of its file.
- The shot later in the file covers the ones before it. An earlier shot is cut where a later one
  covers it and is heard again after it, exactly as it shows again.
- The incoming shot's `fade_in` IS the transition. The outgoing sound runs through it and fades
  out over the same span, and that pair is what `markCrossfades` marks equal-power.
- An ACTIVATION, an event with no `ref`, covers nothing and sounds nothing.

A dissolve's `with:` and `chain:` change only the picture. The sound has one way to cross.

## Seconds in the file, beats on the wire

The engine's clips are in beats, and the shots are in seconds against one `tempo:` with no tempo
map (`packages/song-video/docs/picture.md`). The conversion happens in the compile, every time, so
re-typing `tempo:` leaves the sound under its shot. A sounding clip carries no warp map: the
material answers to the clock, not to the tempo.

## A retimed shot is resampled, and a reversed one is silent

A shot's `speed` ([../../song-video/docs/speed.md](../../song-video/docs/speed.md)) reaches its sound
as a two-marker `varispeed` warp: one second of song spends `speed` seconds of sound, RESAMPLED, so
the pitch follows the speed as a tape's would. The engine's pitch-keeping stretch serves a clip
whose beats follow the tempo, and a shot answers to the clock instead.

The engine has no reverse playback: a warp map only runs forwards, and nothing in it reverses a
clip. A reversed shot is therefore silent, and so is a freeze, which has no sound to hold. Both
stay in the picture's covering rule, so the sound under them is still cut where they start.

## One lane per picture lane, and hidden is not muted

A sounding lane follows a whole picture lane, not one shot, so a cut on that lane never has to
say which audio lane it belongs to. `picture sound` reuses the lane that already sounds a picture
lane, which is what makes it safe to run after every drop.

A picture lane's `mute` hides it and does not silence it. The sound has its own lane, and so its
own mute.
