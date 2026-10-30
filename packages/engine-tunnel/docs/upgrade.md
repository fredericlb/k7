# Accepting a WebSocket — `acceptSocket` and `heartbeat`

Every WebSocket the backend accepts — a share's visitor, a remote camera, a sync replica, a
browser on the engine relay, a supervisor's tunnel, a loopback client of a tunnel channel —
completes its upgrade through `acceptSocket` (`../upgrade.ts`).

## An error listener first, always

`ws` emits `error` on a socket for a protocol fault of the PEER: a frame with RSV1 set where no
extension was negotiated, an unmasked client frame, a frame over `maxPayload`, invalid UTF-8 in a
text frame. An `EventEmitter` with no `error` listener throws, the throw reaches
`uncaughtException`, and the backend exits — with every session, relay room and file service it
carries. Nothing about the fault needs an account: a refused share socket still reads frames
until its close completes.

So `acceptSocket` attaches the listener inside the upgrade's callback, before the caller's own
code runs, and the listener terminates the socket. A caller that wants to log the fault passes
`onError`; one that wants to clean up listens to `close`, which follows the termination. No
caller writes its own `handleUpgrade`: a path that forgets the listener is a remote crash.

## A peer that stops answering is dropped

A phone that leaves the network sends no FIN, and TCP can take hours to give up. A socket the
server keeps for such a peer holds whatever it pins: an engine session, a share's visitor slot, a
relay pair. `heartbeat(ws)` pings every 30 s and terminates a socket that left the previous ping
unanswered, so a dead peer is gone within a minute. The camera hub and the sync relay run the same
rule over their whole server in one loop; a socket served alone — a share's visitor, both ends of
an engine relay — calls `heartbeat` on itself.
