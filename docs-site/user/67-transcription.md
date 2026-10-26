# Transcription

`track transcribe` listens to the speech in a video and turns it into **subtitles** shown over the picture, timed to the words. Use it to caption an interview or a filmed performance.

```
track transcribe <track_in> <track_out>
```

| Argument | Meaning |
|---|---|
| `track_in` | A **picture lane** of the project (a lane extending `@meta/picture-track`). The command completes it from the project's picture lanes. |
| `track_out` | The **picture lane** that shows the subtitles. Created if it does not exist; if it is already a picture lane, its subtitles from an earlier run are **replaced**. |

Example:

```
track transcribe cam subs
```

It is also offered in the right-click menu of a track.

## What it does

1. Takes the **first shot** placed on the picture lane, and the video file that shot's clip names as `source`.
2. Extracts the sound with ffmpeg.
3. Runs whisper on it, in the language spoken. This can take a few minutes; the command says "whisper is listening to …".
4. Writes the words as a subtitle file, `clips/<track_out>.srt`, and a clip `clips/<track_out>.k7x` naming it.
5. Places that clip on the picture lane `track_out`, at the shot's start, length and source offset, so each line shows when it is said.

```k7x
// clips/subs.k7x
source("clips/subs.srt")
```

```k7x
// tracks/subs.k7x — under a shot at 12 s that starts 3 s into its video
extends("@meta/picture-track")
events([ref("subs").start(12).from(3)])
```

The subtitles are an ordinary subtitle clip: set their font, size, colour and position on the clip ([Titles, shapes and subtitles](./55-titles-and-subtitles.md)), and drag them on the timeline like a shot. The `.srt` file is a standard subtitle file you can copy out as is.

Undo (Ctrl+Z) reverts the whole command.

## Requirements

Transcription runs where the project's files are handled, and it needs, on that machine:

- **ffmpeg**, and
- **whisper**: either `whisper` (openai-whisper, `pip install openai-whisper`), which manages its own models, or `whisper-cli` (whisper.cpp), which needs the environment variable `STUDIO_WHISPER_MODEL` set to a ggml model file.

`whisper` is tried first, then `whisper-cli`. If neither is installed, the command says so and names both.

## When it refuses

| Message | Cause |
|---|---|
| `no picture lane "cam" in this song` | The song has no picture lane named `cam`. |
| `'cam' places no shot` | The lane has no shot, so there is nothing to listen to. |
| `clip '…' says no source` | The shot's clip has no `source:`. |
| `clip '…' is not a video` | The source is an audio file; transcription listens to picture lanes only. |
| `the video is not on this machine` | The file the clip names is missing. |
| `whisper heard no speech in this video` | Nothing was recognised; nothing is written. |
| `'…' is a sound lane` | `track_out` names an existing lane that plays sound; subtitles need a picture lane. Name another one. |
| `clip '…' is not a subtitle file` | `clips/<track_out>.k7x` already names a video or a sound. Name another lane. |
| A track or lane name with other characters | Names may use letters, digits, `.`, `_` and `-` only. |

Only the first shot of the lane is transcribed. A lane that cuts between several videos is not re-timed onto the timeline.
