# The remote cameras' hub

`src/cameras/`: the routes and the signalling socket behind the home page's `camera mode` and the
`remote:` camera nodes. What a remote camera is, and why the picture goes peer to peer, is
`packages/web-protocol/docs/cameras.md`.

| | |
|---|---|
| `GET /api/cameras` | the account's cameras that are on: `[{ name, since }]` |
| `POST /api/cameras/ticket` | `{ ticket, iceServers }` — what opens the socket |
| `WS /api/cameras/ws?ticket=…&role=camera&name=…` | a device in camera mode |
| `WS /api/cameras/ws?ticket=…&role=viewer` | a browser drawing or recording one |

## A ticket, because an upgrade skips Express

The session guard is Express middleware, and a WebSocket upgrade never reaches Express. So the guard
runs on the ticket route, which mints an HMAC binding the **account** for a minute, and the upgrade
checks that — the engine relay's pattern (`packages/engine-registry/docs/proxy.md`). The secret is
per process: a restart costs a socket one reconnect, which the camera does anyway.

## In memory, by the socket's life

A camera is listed for exactly as long as its socket is open: nothing is written, and a restart
lists none until the devices reconnect. A list on disk would list cameras that are off. A socket
that misses a ping for thirty seconds is dropped, so a phone that lost its network leaves the list.

## What the hub decides

- **Which camera a viewer gets**: `matchRemoteCamera` over the account's cameras, never anyone
  else's. The sentence explaining a fallback travels on the camera's offer.
- **The unique name**: a second camera under a name already on gets ` (2)`.
- **Who may talk to whom**: a camera's frame reaches a viewer only if that viewer asked for that
  camera; a viewer's reaches only the camera it was matched to.
- **The caps**: eight cameras and thirty-two viewers per account, and 64 KiB per frame — signalling
  is SDP and candidates, and each viewer is a peer connection the camera encodes for.

`K7_CAMERA_ICE_SERVERS` names the STUN/TURN servers handed to both ends: comma-separated URLs, or a
JSON array of `RTCIceServer` when a TURN server needs credentials. Unset, there are none.

It is mounted ahead of the media library, whose catch-all `/api` guard would otherwise answer
first, and its upgrade listener sits beside the engine relay's, ignoring every other path.
