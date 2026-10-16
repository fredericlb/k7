# @studio/ffmpeg

Every Node process of this repo that runs ffmpeg or ffprobe — the media library's MP3s and
analysis, a video's probe and copies, a rehearsal clip or concatenation, a transcription's audio,
a render's mp3 — takes the binary, the input arguments and the missing-binary error from here
(`src/ffmpeg.ts`). The engine and the supervisor are C++ and keep their own; the supervisor applies
the same rule to its stem cut (`engine/k7-supervisor/docs/supervisor.md`).

## One bin resolution

`FFMPEG_BIN` and `FFPROBE_BIN` name the binaries, `ffmpeg` and `ffprobe` on the `PATH` otherwise,
and every caller asks `ffmpegBin()` / `ffprobeBin()`. A deployment that ships ffmpeg outside the
`PATH` sets the variable once and every feature finds it; a caller that spelled `"ffmpeg"` itself
would be the one feature that silently does not. The variables are read at each call, not at import,
so a test or a host that sets them after loading a module is still heard.

## The protocol whitelist is the default

Every input is built with `input(path)`, which puts `-protocol_whitelist file,pipe` before its
`-i`. The files ffmpeg reads here are uploads, recordings and footage, and a container can name
another resource — a playlist, a reference movie, a concat list. Without the whitelist, opening a
crafted upload makes the server fetch a URL of the uploader's choosing. With it, ffmpeg may open
local files and pipes and nothing else, nested opens included.

The option is an INPUT option: it applies to the next `-i` and is then reset. A command with
several inputs (the rehearsal concatenation) carries it once per input, which is why inputs are
never written by hand.

`input()` also names the path as a file (`file:<path>`). Under the whitelist ffmpeg reads the text
before a colon as a protocol, so an upload called `Song: Remix.mp3` would otherwise be refused as
an unknown one. `-` and `pipe:` inputs pass through as they are.

It is applied even where the input is a file this repo wrote itself (a render's wav), because
whether a path is trusted is not something the call site can be relied on to know. An input that
is not a file at all is the one exception: a `-f lavfi` source is a generated signal, opened by no
protocol, and only tests use one. The concat DEMUXER (`-f concat` on a list file) would need
`file` only, and `-safe 0` widens which paths the list may name, not which protocols; nothing here
uses it, the rehearsal concatenation being a filter over separate inputs.

## One error class

A missing binary is `NoFfmpegError`, whichever feature hit it. Callers catch it to answer 503, stop
a sweep for good, or fall back to the engine's decoder, and they test it with `instanceof`: with one
class per feature, a route that imported two of them could test against the wrong one and turn a
missing install into a 422 or a crash. Its message is shown to users, so the constructor takes
`why` — what the binary was for and what to do about it — and the class stays one.
