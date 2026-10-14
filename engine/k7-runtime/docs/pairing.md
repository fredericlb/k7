# Pairing — who may drive the engine over the LAN

The engine listens on every interface (the supervisor sets `STUDIO_ENGINE_HOST=0.0.0.0`), because a
phone or a second laptop on the same network driving the transport from the stage is a real use, and
it must work at a venue with no internet. Without pairing, that same port let anyone on the room's
Wi-Fi drive a project, read the engine's token, and ask it to load a binary from a path of their
choosing.

So a LAN peer drives only once **paired**: the musician approves the device once, on the machine, and
the device keeps a key it shows on every connection.

## Loopback needs nothing, and that includes the relay

A peer whose address is loopback is the machine itself and is trusted outright — k7 open on the
machine, the supervisor, the file service. Traffic the SERVER relays — the tunnel and the WebRTC
path — also arrives from loopback, because the supervisor dials the engine on `127.0.0.1` to carry
it. That is right: the server authenticated the browser before relaying it (a session, then an engine
ticket), so pairing it again would be asking twice.

The consequence to keep in mind: "local" is decided by the peer address alone. Anything that proxies
LAN traffic into the engine over loopback makes that traffic local, and must authenticate it first.

## What an unpaired LAN peer may say

Three things, and every other message is answered `{type:"error", code:"unpaired"}`:

- `whoami` (or `hello`) — answered with the id and `needsPairing: true`, and **never the token**. A
  probe still learns an engine is there and that it wants pairing.
- `pair-request` — the request the musician approves.
- `pair` — a key, from a device already paired.

Machine-wide broadcasts skip untrusted sockets too: an unpaired peer hears its own refusals and
nothing else.

## The flow, and why the code is shown on both sides

The device sends `pair-request` with a name ("iPhone · Safari"); the engine answers with a six-digit
code, which the device shows. The machine's own clients — k7 on the machine, and the app through
the supervisor — see the request with the same name, address and code, and the musician approves it
there. The code is what makes a request in a crowded room the right one: two "iPhone · Safari" can ask
at once, and the musician approves the one whose code is on the phone in their hand.

On approval the engine sends the device its key, once, on the socket that asked. The browser keeps it
per engine id and shows it as the first frame of every socket it opens to that engine.

Requests expire after two minutes and at most eight wait at once, one per socket: a peer cannot queue
the room. Approving, denying, listing and revoking are refused over the LAN, a paired device included
— a phone that drives cannot pair a second one.

## Keys

32 random bytes from the OS's generator, kept in `<state>/paired-devices.json` in clear, like the
engine's own token in `engine-id.json`: whatever can read that folder owns the machine already.
Compared in constant time. The file is written aside and renamed, so a crash mid-write unpairs nobody;
an unreadable one pairs nobody, and the next approval rewrites it.

**Revoking** removes the key and closes that device's live connections: an unpaired phone must not
keep driving until it happens to reconnect. The device forgets a key the engine refuses, so it shows
"pair this device" again rather than failing in a loop.

**The engine's token pairs too.** The registry holds it, and its relay may dial the engine over the
LAN when the server is not on the engine's machine; it shows the token as its key. A paired device
also learns the token, from `whoami` — it could pair with it as well, which grants nothing it does not
already have.

## What this does not do

It authenticates; it does not encrypt. The LAN path is plain `ws://`, so a device on the same network
that can sniff the traffic sees the key go by. That is the trade for working with no internet and no
certificate on a stage, and it is stated here so nobody builds on it as more than it is.
