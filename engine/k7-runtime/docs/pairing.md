# Pairing — who may drive the engine over the LAN

The engine listens on every interface (the supervisor sets `STUDIO_ENGINE_HOST=0.0.0.0`), because a
phone or a second laptop on the same network driving the transport from the stage is a real use, and
it must work at a venue with no internet. Without pairing, that same port let anyone on the room's
Wi-Fi drive a project, read the engine's token, and ask it to load a binary from a path of their
choosing.

So a LAN peer drives once **paired** — the musician approves the device once, on the machine, and the
device keeps a key it shows on every connection — or while the musician leaves the **LAN open**.

## The open LAN

A home or a rehearsal room is the network the engine is mostly on, and pairing every phone there is a
chore the room does not need. So the supervisor's `lanOpen` (`engine-host.json`, on by default, the
**Available on the local network** switch of the engine's settings page) lets a peer on a **private**
address drive unpaired: 10/8, 172.16/12, 192.168/16, 169.254/16, `fc00::/7`, `fe80::/10`
(`isPrivateAddress`, `Pairing.cpp`). A public address — a port someone forwarded on a router — still
pairs, open or not; and the verbs that manage pairing stay the machine's own either way.

The engine learns it from the supervisor, not from its environment: a `lan-open` message on the
supervisor's own loopback socket, sent each time the engine comes up and each time the switch moves.
An engine nobody has told keeps the LAN **closed** — one started by hand, or by an older supervisor —
which is the side to fail on. Closing it drops at once every socket the open LAN let in
(`lanTrusted`): a phone that was driving must pair before it drives again. A message, rather than a
variable read at start, because a phone's engine cannot restart without the app's process doing so.

Open is a choice made for the room the product is for, and a café's Wi-Fi is what the switch is for.

## Loopback needs nothing, and that includes the relay

A peer whose address is loopback is the machine itself and is trusted outright — k7 open on the
machine, the supervisor, the file service. Traffic the SERVER relays — the tunnel and the WebRTC
path — also arrives from loopback, because the supervisor dials the engine on `127.0.0.1` to carry
it. That is right: the server authenticated the browser before relaying it (a session, then an engine
ticket), so pairing it again would be asking twice.

The consequence to keep in mind: "local" is decided by the peer address alone, once the page
check below has let the socket in. Anything that proxies
LAN traffic into the engine over loopback makes that traffic local, and must authenticate it first.

## A page from another site is closed at the handshake

Loopback trust is about the PEER, and every web page the musician has open is a loopback peer: any
site can run `new WebSocket("ws://127.0.0.1:8765")` from the browser on this machine. So before
pairing is even asked, the handshake's `Origin` header is checked (`screenOrigin`, with the rule in
`Pairing.cpp`'s `originAllowed`), and a socket whose origin is not allowed is closed with code 1008
and never trusted — every message it sends before the close is dropped.

Allowed:

- **no `Origin` header** — a native client: the supervisor, a Node process such as k7's backend
  under the tray. A browser always sends one, so a page cannot pass for one of these;
- a `ws://` or `wss://` origin, which a browser never sends: it is IXWebSocket's default for a native
  client, the supervisor's included;
- loopback pages, any port or none, on `http` or `https`: `127.0.0.1`, `localhost`, `[::1]` — a
  page on the tray's backend, a dev server, the phone app's shell page (`https://localhost`) and its studio
  views (`http://127.0.0.1:<port>`);
- `https://k7.rocks` and `https://<sub>.k7.rocks` — the app, its dev instance, the docs — on the default port only;
- every origin listed in `STUDIO_ENGINE_ALLOWED_ORIGINS`, comma-separated and matched exactly
  (scheme, host and port). The supervisor sets it to the origins of the studios this machine is
  listed at, so a self-hosted studio's pages reach its engine; a studio added after the engine
  started counts from the engine's next start.

Not allowed: every other site, `null` (a sandboxed frame, a `file:` page) and anything that does not
parse as an origin. What is left to trust is what the machine itself serves on loopback, which is
the machine already.

On a phone the engine is started by the app rather than spawned, and the supervisor's start frame
carries the same list as `origins`, which `EngineBridge.kt` exports as `STUDIO_ENGINE_ALLOWED_ORIGINS`
before it starts the engine.

## What an unpaired LAN peer may say

With the LAN closed, or from a public address: three things, and every other message is answered `{type:"error", code:"unpaired"}`:

- `whoami` (or `hello`) — answered with the id and `needsPairing: true`, and **never the token**. A
  probe still learns an engine is there and that it wants pairing.
- `pair-request` — the request the musician approves.
- `pair` — a key, from a device already paired.

Machine-wide broadcasts skip untrusted sockets too: an unpaired peer hears its own refusals and
nothing else.

None of the three is more than a few hundred bytes, so a frame over **16 KB** from a socket not yet
trusted is refused before it is parsed (`screenFrameSize`). The socket accepts frames far larger
than that for a paired client's documents, and parsing one is the costly part, so without the cap
anyone on the room's Wi-Fi could make the engine parse megabytes of JSON per message for nothing.

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
Compared in constant time. The file is readable by its owner only, and written aside and renamed, so a crash mid-write unpairs nobody;
an unreadable one pairs nobody, and the next approval rewrites it.

**Revoking** removes the key and closes that device's live connections: an unpaired phone must not
keep driving until it happens to reconnect. The device forgets a key the engine refuses, so it shows
"pair this device" again rather than failing in a loop.

**The engine's token pairs too.** The registry holds it, and its relay may dial the engine over the
LAN when the server is not on the engine's machine; it shows the token as its key, compared in
constant time like a device's (`sameKey`). A paired device
also learns the token, from `whoami` — it could pair with it as well, which grants nothing it does not
already have.

## What this does not do

It authenticates; it does not encrypt. The LAN path is plain `ws://`, so a device on the same network
that can sniff the traffic sees the key go by. That is the trade for working with no internet and no
certificate on a stage, and it is stated here so nobody builds on it as more than it is.
