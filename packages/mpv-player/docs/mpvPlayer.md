# Playing on the host's own speakers, without any engine

A destination that makes sound where the FILES are: the host plays one through `mpv`, on its own
outputs. No engine is involved, and this package does not know that engines exist.

## Two hosts, one driver

The file service and k7's backend both mount it, and they differ in exactly one thing — where the media
is. The file service plays from its **cache** of the médiathèque; k7's backend plays from the médiathèque
**itself**, which it serves. So the root is injected (`configureMpv`) rather than read here, and
so is the answer to "who is asking", which one host takes from a header and the other from a
session.

Nothing else varies, which is why the HTTP surface is in this package too rather than written
twice.

## Why not the engine

The engine plays a file perfectly well — but it plays **a project in a session**, and that
session is shared with everything else auditioning. Using it to listen to music takes the
transport away from whatever k7 was doing with it. Nothing is asked of it here, so one can
listen while the engine serves k7 — which is exactly the use of a machine that is a player and
not an instrument.

## Why nothing crosses the network

The file **is already there**, on the host that will play it. It is sent "play this path", not
bytes. That is what rules out a PulseAudio/PipeWire network sink, which would have the browser
download, decode, and send raw PCM back to a machine holding the file on its own disk.

## The path is RELATIVE, and that is the guard

The client sends `songs/AC-DC/Back in Black/Hells Bells/original.flac`, never an absolute path,
and the host resolves it against **its own** media root. That is not convenience but the
guarantee: a client can only name what that root holds. A `..` is **refused** rather than
normalised — it is an attempt, not a typo, and naming it beats silently correcting it.
`player.test.ts` checks three escape shapes plus the absolute path.

A pleasant side effect: this destination needs **no resolution** browser-side. `NowPlaying.path`
is already médiathèque-relative and goes as it is.

The reported state carries the **requested** path, not the one mpv knows: mpv's is absolute, and
returning it would expose the machine's directory layout to a client that has no use for it.

## `--ao=alsa`, and why it is the right default here

The target machine is **headless**, and PipeWire and PulseAudio are user-session services:
without a graphical session they do not start on their own, and it would take
`loginctl enable-linger` for the user systemd to come up at boot. On a dedicated player, doing
without a sound server is simpler **and** more reliable. Hence `--ao=alsa`, overridable with
`STUDIO_PLAYER_AO` on a machine with a working PipeWire.

The catch to know: raw ALSA is **exclusive**. If the engine already holds the card (JUCE opens it
and keeps it), mpv will not open it. On a dedicated player that is harmless — the engine is there
only to be discovered. On a machine that really plays from both sides you need a mixing PipeWire,
so `STUDIO_PLAYER_AO=pipewire` and a lingering session.

## One mpv per person, kept idle

`--idle=yes` makes it wait for a `loadfile` instead of exiting: relaunching per song would cost a
process start for nothing. `--no-config` too, because this process is an organ of this service
and not somebody's mpv session — a `~/.config/mpv` full of scripts has no business here.
`--load-unsafe-playlists=no` and `--ytdl=no` likewise, and `play` refuses any name that is not an
audio extension (`isAudio`, `@studio/mediatek/media`): a playlist on the volume names URLs and
other files, and mpv would follow them.

Control goes over its [JSON IPC](https://mpv.io/manual/master/) on a unix socket, one line per
message. That IPC has **neither authentication nor encryption**: acceptable because it is purely
local and the host's own auth gate sits in front of it.

State is **read on demand** rather than tracked from events, which avoids keeping it current on
both sides of the socket. The four properties go together on one connection, so it is one round
trip and not four.

## What the browser sees

mpv is on another machine and has no way to push its position into the bottom bar, so it is
**polled**, twice a second — enough that a progress bar does not stutter, little enough not to
hammer a machine whose only job this is.

The end of a song is clean, unlike the engine's which has to be inferred: mpv goes idle
(`idle-active`). `weStopped` remains, for the reason it exists elsewhere — a requested stop looks
like an ending.

Seeking is **optimistic**: the handle follows the finger and the next poll tells the truth.
Waiting for the round trip would jump the cursor backwards under the mouse.

Closing the bar **silences the machine**. Otherwise it carries on without us: it is a process
over there, not an element of this page.

## What the machine needs

`mpv` on the PATH — that is all, and it is probed on demand, as yt-dlp is. Without it the route
returns 503 with the sentence, rather than failing silently. The hosted image installs it
alongside ffmpeg and yt-dlp; a musician's machine may not have it, which is what the 503 is for.
