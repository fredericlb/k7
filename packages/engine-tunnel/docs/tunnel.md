# The engine tunnel

An engine sits on a musician's machine, behind a home router, and the server that lists it cannot
dial it. So the engine's **supervisor dials out**: one WebSocket to the registry it already
heartbeats to, `<registry>/api/engine-tunnel`, and the server opens virtual channels to the engine
through it. Every server-side process that needs an engine — the relay a browser uses, a hosted
file service — reaches it that way, however far apart the two are.

## Who may hold a tunnel

Only an engine the registry lists, presenting that engine's token in `x-studio-engine-token`. A
header and never the query string, so no access log keeps the secret. One tunnel per engine: a
reconnect replaces the socket it outlived rather than adding a second.

Both ends ping every 20 s and drop a peer that missed one. A tunnel that died without a FIN would
otherwise look alive for ever, and its channels with it.

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
real name.

## What it does not do

- **Evict.** The cache grows with every project opened on the machine. Deleting
  `<state>/remote/<host>` is always safe; the next open fetches again.
- **Relay a file service over HTTP.** The engine machine's own file service is reached by the
  older relay (`packages/engine-registry/proxy.ts`), which needs the server to share its network.
  A server-owned project has no engine-side file service to reach — see
  `packages/file-hub/docs/fileHub.md`.
