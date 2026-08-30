# A lens on this machine, drawn on another

`apps/st0/frontend/docs/external.md` is what an external surface is, and
[externals.md](externals.md) is what this app has to get right for one to work over the LAN.
This page is the one thing a second device could not have at all until now: a **camera**.

## The wall, and the door beside it

A tablet reaching this app at `http://192.168.x.x:<webPort>` is **not** in a secure context, and
`getUserMedia` is gated on one — in an insecure context `navigator.mediaDevices` is not merely
refused, it is *undefined*. No permission dialog, nothing to grant, nothing to grant it to.

`RTCPeerConnection` is gated on nothing. That asymmetry is the whole of this page:

| | on `http://192.168.x.x` |
|---|---|
| `getUserMedia` | absent — the API is not there |
| `fetch("http://…")` from an https page | blocked as mixed content |
| `ws://…` from an https page | blocked as mixed content |
| **`RTCPeerConnection` to a bare LAN address** | **allowed, and needs no certificate** |

A peer connection is not a fetch, so the mixed-content rule never applies to it, and DTLS-SRTP
carries its own security off a fingerprint in the SDP rather than off a CA. So the picture can
travel where nothing else may.

## Which way it travels, and why that way

**The machine opens the lens; the tablet receives it.** Not the other way round, which is the
first idea and is impossible: the tablet cannot capture at all, having no secure context.

That direction is also the one `packages/song/docs/camera.md` already wanted. A node names its
lens by the LABEL a person reads, and `matchCamera` resolves that label against the browser that
draws. A project authored on the machine naming `"Logitech BRIO"` would, matched on a tablet,
find nothing and fall back to that tablet's own front camera — silently, since nothing is
refused. Opening it where it was named keeps the file meaning what it says.

The machine's end is st0's own window, on the loopback origin — which is both the secure context
that makes the capture possible and the proof that it is this machine and not a guest on its LAN.
`canServeLenses()` is that one predicate.

## What this server does, which is very little

`src/server/cameraRtc.ts` is a **signalling relay** and never carries a frame of video. It holds one
host slot and any number of viewers, mints the id a viewer is addressed by, and forwards
offer / answer / ICE between them. It reads a frame only far enough to route it: what two
browsers negotiate is their business.

Three rules are worth stating because none of them shows when it is wrong:

- **The host end is loopback only.** Offering a lens is claiming to *be* the machine, and
  `origin.ts` is where that rule already lives for the pl8 proxy.
- **A viewer from the LAN presents the engine token**, which is what the file service already
  asks that same device for on 8770. The token is not a secret from the browser
  (`@studio/engine-registry/docs/token.md`); it is the light LAN gate, and this is a matching
  weight of door for a matching thing behind it.
- **The relay mints the viewer id.** Neither browser may choose who it claims to be, and the id
  is stripped on the way back out — a viewer has no use for it, and no business knowing it.

There is **no STUN server**. Both ends are on one LAN, and the case this exists for is a
rehearsal room with no internet; a public STUN address there is a three-second timeout and
nothing else. Chrome replaces the viewer's host candidates with an mDNS `.local` name, which
resolves on the same LAN, and the machine's own candidates are real ones because that page holds
a camera permission.

## The failure signatures

- **No window open on the machine** → the viewer is told so in words. It matters that this is a
  message and not a silence: a peer connection that simply never answers reads as a frozen lane.
- **The window closes mid-session** → every viewer is told, for the same reason.
- **A lens the machine has not got** → the sentence `matchCamera` produced travels *with* the
  offer, so the tablet draws the same explanation the machine's own viewport would.

## What is still not there

The camera is the only powerful feature this buys back. A second device on plain http still has
no service worker, so no install and no offline — see `apps/st0/frontend/docs/external.md` for
what it gets instead, which is fullscreen and a screen that stays lit.
