# The engine tunnel

An engine sits on a musician's machine, behind a home router, and the server that lists it cannot
dial it. So the engine's **supervisor dials out**: one WebSocket to the registry it already
heartbeats to, `<registry>/api/engine-tunnel`, and the server opens virtual channels to the engine
through it. Every server-side process that needs an engine — the relay a browser uses, a hosted
file service — reaches it that way, however far apart the two are.

## Who may hold a tunnel

Only an engine the registry lists, presenting that engine's token in `x-studio-engine-token` and,
once the id is bound to one, its machine's tunnel secret in `x-studio-tunnel-secret`
(`packages/engine-registry/docs/token.md`). Headers and never the query string, so no access log
keeps them. One tunnel per engine: a reconnect that passes that check replaces the socket it
outlived rather than adding a second; one that fails it is refused before the live tunnel is
touched, so nobody holding the token alone can take an engine's channels over.

Both ends ping every 20 s and drop a peer that missed one. A tunnel that died without a FIN would
otherwise look alive for ever, and its channels with it.

## Nothing on a tunnel is trusted for shape

Holding a tunnel needs no account, and the heartbeat that lists an engine is open:
whoever runs a supervisor can send the hub anything. A throw inside a socket listener is an
uncaught exception, and k7's backend exits on those. So:

- every agent text frame goes through `parseAgentMessage` and every binary header through
  `asBinaryHeader` (`frames.ts`) — a non-null object, a known `t`, integer `ch`/`req`, `paths` an
  array of strings — and a frame of any other shape is ignored, never read;
- every upgrade and message listener on the hub, the relay and the agent catches what is thrown,
  says it and drops that socket alone; the async handlers (`stat`, `get`, `put`) end in a `catch`;
- the hub and the relay accept frames up to `MAX_FRAME_BYTES` (16 MiB). The largest legitimate
  frame is a file chunk, `CHUNK_BYTES` plus its header, or an engine frame passed through — a
  document or a plugin list — which stays well under it; the `ws` default would let one frame
  hold 100 MiB of the server's memory.

## A channel looks like a WebSocket

`TunnelChannel` is shaped like the slice of a `ws` socket the relay and the file service's
`EngineClient` use. The relay pipes one without knowing it is not a socket. A process that only
speaks `ws://` URLs gets a **loopback address bound to an engine** (`bindLocal`): the key in the
path is the only credential, and it is refused to anything that is not loopback.

## Server-owned files, played from a local copy

The engine opens files by local path and cannot do otherwise without playing silence, so a
server-owned project is played from a **copy on the engine's machine**, under
`<state>/remote/<server host>/<root name>`. The server shares **roots** with a channel when it
opens it; the agent rewrites every JSON string under a root as frames cross:

- **server → engine**: the file is downloaded **before** the frame naming it is delivered. A
  whole document (`project`) is re-checked against the server; a delta trusts what the last
  document settled, since a delta is meant to be sent at note rate.
- **engine → server**: a file the engine changed (a take, a plugin snapshot) is uploaded
  **before** the frame naming it is delivered, so a server that files the take finds it there.

One queue per direction per channel: a frame waiting on a download is never overtaken by the one
after it, which is what keeps a `transport play` behind the document it plays.

Every channel shares one socket, so file bytes — a download, an upload, a `sync` copy — are also
what every OTHER channel's frames wait behind: a relayed probe, a transport command. The senders
stop at **1 MB** unsent (`HIGH_WATER_BYTES` in `drain.ts`, `kHighWaterBytes` in
`engine/k7-supervisor/src/TunnelFrames.h`) rather than several: on a home uplink a few megabytes
ahead of a `whoami` is seconds, longer than a probe waits before calling the engine unreachable.
The kernel's own socket buffer keeps the pipe full past that.

**A file is served only from INSIDE its root**, by real path (`stillInside`, `hubFiles.ts`), so a
link cannot aim the engine's machine at anything else on the server. The two library roots are
`perChild`: each top-level folder there is one library's clone, and containment is checked against
THAT folder's real location. A clone may then be a link — an admin's edit clone pointed at a
checkout, as a dev machine has it — while a link inside a library still cannot leave the library.
Without it every file of a linked clone answers `missing`, and the agent makes the folder and
nothing in it.

That same queue is why a hosted file service opens its engine channel **`synced`**: frames to the
engine are then only rewritten, never held for a download, because every file a document names was
copied before the document was sent, by a **`sync`** request on the jobs channel. The agent answers
that one itself: it stats the files, copies the ones that differ (eight at a time), answers
`syncing` after each one with the counts of what it had to copy, and `synced` with how many failed.
The decision and its failure modes are `packages/file-service/docs/engineSync.md`. An agent that does
not know the flag downloads as above, which is what keeps an old machine working against a new
server.

Only **whole strings** are rewritten, never substrings, and only under a shared root. A plugin
path, a device name, anything of the engine's machine is left alone because no root covers it.

**A file the engine holds open is never waited for.** On Windows a rename over a file another
process has open is refused, and the engine keeps open the clips of what it played. The new version
is then placed BESIDE it, `clip~<server mtime>.wav`, and the map names that copy from then on:
`toLocal` follows the redirect, `toRemote` reads it back as the canonical path, so nothing mistakes
it for a file to upload. The ledger stays keyed by the canonical path; a version placed that way is
found again by its name after a restart, and the copy it replaces is removed once nothing holds it.

A download lands beside its target and is renamed over it, stamped with the server's mtime: a
file whose size and mtime match is already here, including across a supervisor restart, when the
in-memory ledger is gone. Reads of a file the engine is still writing are not guarded against;
the frames that name engine-written files (`recorded`, `pluginBaseSaved`) are sent after the
engine closed them.

## The server confines every path

The hub answers file requests only inside the roots the channel was opened with, checked on the
**real** path: a cloned repository may carry a symlink pointing anywhere on the server, and a
lexical check would follow it. Only roots opened `writable` accept an upload, written beside the
target and renamed over it when complete, so a dropped tunnel never leaves half a file under a
real name. The part file's name carries random bytes and is created exclusively (`wx`), so two
uploads of one path never write into the same part.

Holding a tunnel needs no account, so what it may upload is **bounded** (`uploadLimits`,
`hubFiles.ts`): 16 uploads open at once per tunnel; 2 GiB per upload
(`STUDIO_TUNNEL_MAX_UPLOAD_BYTES`), well above an hour-long multitrack take; 20 GiB per tunnel per
hour (`STUDIO_TUNNEL_UPLOAD_BYTES_PER_HOUR`); and 60 s without a chunk. An upload past any of them is
aborted, its part file deleted, the agent answered a `put-reply` with the reason, and its later
chunks ignored. Without them an agent opening request after request would hold a write stream and
a growing file each, until the tunnel dropped.

## What it does not do

- **Evict.** The cache grows with every project opened on the machine. Deleting
  `<state>/remote/<host>` is always safe; the next open fetches again.
- **Relay a file service over HTTP.** The engine machine's own file service is reached by the
  older relay (`packages/engine-registry/proxy.ts`), which needs the server to share its network.
  A server-owned project has no engine-side file service to reach — see
  `packages/file-hub/docs/fileHub.md`.
