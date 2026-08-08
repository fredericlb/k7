# Two servers, and the one that is missing

l8 and m9 each talk to three: their own backend, a machine's file service, and that
machine's `engine/moteur`. v1 talks to **two**.

| | v1's backend | the machine's file service |
|---|---|---|
| holds | who you are, which machines exist, which one you work from | the project's files AND the footage |
| reached | same-origin `/v1/api` | absolute URL — direct when the browser may, else relayed through this origin |

## Why there is no engine

The moteur plays audio. A cut has none — its lanes' sources are video files whose own
audio is dropped by design, exactly as it was when l8 drew picture.

Everything the engine gave l8's video pane was a **number**: the playhead, twenty times a
second, which `EngineClock` interpolated between frames so the renderer had a smooth
second to draw against. Keeping a process that owns a sound card alive to produce that
number would be the tail wagging the dog.

So v1 owns the clock. `TransportClock` (`@studio/ui-eyes/clock`) is `Date.now()` plus an
anchor, and it is the AUTHORITY rather than a follower: play, pause and seek all move it,
and each announces itself through `onSeek` so the realtime driver can hard-seek every
`<video>` onto the right frame. A seek that stayed quiet would leave the picture on the
old frame while the ruler said otherwise.

That is the whole of the change to the shared renderer. `RealtimeDriver` used to take an
`EngineClock`; it now takes a `SeekingClock`, which both implement — one because it
follows a socket, one because it *is* the transport.

## Why there is still a registry

Because a project lives on a **machine**, and the registry is how a browser learns that
machine's file-service base and its token. The gate is picking a machine, not a sound
card, and its wording says so.

This is also why `wsPaths` in `vite.config.ts` still carries the engine relay: the
registry's probe opens a WebSocket to measure the link and to read `whoami`, which is
where `fileBase` comes from. Nothing after that point opens one.

## The footage

Streamed from the same file service as the YAML, through `mediaUrl` — a `/media` URL
carrying the user, the workspace, the path and the engine token as query parameters,
because a `<video src>` cannot send headers.

The bytes never touch v1's backend. That is the same rule m9's decks follow and for a
plainer reason here: a hosted service proxying rushes would be the studio's whole
bandwidth for a file already sitting on the machine you chose.
