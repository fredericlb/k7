# Transcription

`track transcribe` listens to the speech in a video and writes it, timed, into a track as text. Use it to get subtitles or lyrics from a filmed performance or an interview.

```
track transcribe <track_in> <track_out>
```

| Argument | Meaning |
|---|---|
| `track_in` | A **picture lane** of the project (a file `video_tracks/<name>.k7x`). The command completes it from the project's picture lanes. |
| `track_out` | The track that receives the transcript. Created if it does not exist; if it exists, its `content:` is **replaced**. |

Example:

```
track transcribe cam lyrics
```

It is also offered in the right-click menu of a track.

## What it does

1. Takes the **first shot** placed on the picture lane, and the video file that shot's clip names as `source`.
2. Extracts the sound with ffmpeg.
3. Runs whisper on it. This can take a few minutes; the command says "whisper is listening to …".
4. Writes the result into `track_out`'s `content:` field as SRT text: numbered cues, each with a start and end time and its words.

```k7x
content(`1
00:00:01,480 --> 00:00:04,120
Good evening everyone

2
00:00:05,000 --> 00:00:07,300
this one is called Hells Bells
`)
```

The times are **in the video file's own seconds**, from the start of the file, not positions on the timeline. Because the text is valid SRT, it can be copied out as a subtitle file as is.

Undo (Ctrl+Z) reverts the whole command, including a replaced `content:`.

## Requirements

Transcription runs where the project's files are handled, and it needs, on that machine:

- **ffmpeg**, and
- **whisper**: either `whisper` (openai-whisper, `pip install openai-whisper`), which manages its own models, or `whisper-cli` (whisper.cpp), which needs the environment variable `STUDIO_WHISPER_MODEL` set to a ggml model file.

`whisper` is tried first, then `whisper-cli`. If neither is installed, the command says so and names both.

## When it refuses

| Message | Cause |
|---|---|
| `no picture lane "cam"` | No `video_tracks/cam.k7x`. |
| `'cam' places no shot` | The lane has no shot, so there is nothing to listen to. |
| `clip '…' says no source` | The shot's clip has no `source:`. |
| `clip '…' is not a video` | The source is an audio file; transcription listens to picture lanes only. |
| `the video is not on this machine` | The file the clip names is missing. |
| `whisper heard no speech in this video` | Nothing was recognised; no track content is written. |
| A track or lane name with other characters | Names may use letters, digits, `.`, `_` and `-` only. |

Only the first shot of the lane is transcribed. A lane that cuts between several videos is not re-timed onto the timeline.
