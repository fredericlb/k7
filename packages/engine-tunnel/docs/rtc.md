# The WebRTC path — a browser straight to an engine on another machine

An HTTPS page cannot open `ws://` to a LAN address (`packages/engine-registry/docs/proxy.md`), so
a phone on the stage, or a laptop across the room, reaches the engine through the server's relay:
every play press and every meter frame goes out to the server and back. A WebRTC data channel is
the one direct path such a page is allowed, and it is **offered beside the relay, never instead
of it**: the probe races both and keeps the faster (`packages/engine-browser/docs/access.md`).

## Who answers the offer

The engine's **supervisor**, over the tunnel it already holds: the browser POSTs its offer to
`/api/engine/<id>/rtc` on the registry, the hub hands it to the supervisor, the supervisor answers
and pipes the channel to the local engine exactly as the tunnel pipes a channel. The engine never
learns WebRTC exists. An engine is offered this path only when its supervisor holds a tunnel
(`PublicEngine.rtc`), since that is what carries the offer.

Signalling is **one request and one answer**, candidates included — no trickle. It costs up to
1.5 s of gathering on the first connect, and it spares the server a signalling session to keep.

## node-datachannel, and why it is optional

The supervisor uses **node-datachannel** (libdatachannel): its transport runs on native threads,
off the supervisor's event loop, and it is the established stack for the encryption and SCTP a
data channel needs. It is an **optional** dependency, loaded on first use: a machine where its
prebuilt binary is missing answers the offer with a refusal, and the browser keeps the relay.
Nothing else in the supervisor depends on it.

## The local network only, by default

Neither end is given a STUN or TURN server, so the candidates are the machines' own addresses: the
path works on the engine's network, which is where a second device usually is, and falls back to
the relay elsewhere. `TunnelAgentOptions.iceServers` is where the supervisor's side would take one;
the browser's would need the same, and neither is configured today.

## Frames are fragmented

A browser refuses a data-channel message past its size limit, and a whole project document passes
it. Every frame is therefore cut into 16 KB fragments carrying one byte of kind (text or binary,
more or last) — `@studio/web-protocol/rtc-frames`, the one codec both ends import. The channel is
ordered and reliable, as the engine's protocol assumes a WebSocket is.
