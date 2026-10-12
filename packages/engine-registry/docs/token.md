# The per-engine token: what it proves, and what it does not protect

**The per-engine token does not stay server-side.** That sentence must not be written the other
way round: a false security claim is worse than no claim, because people build on it.

## What actually happens

The engine answers `whoami` with its id, its token and its audio timing — to the machine's own
sockets, to the server's relay, and to a LAN device once it is PAIRED. An unpaired LAN peer gets the id
and `needsPairing` and never the token (`engine/st0-engine/docs/pairing.md`):

```
// engine/st0-engine/server/Serve.cpp, the `whoami` / `hello` branch
ws.send(json{{"type", "whoami"}, {"id", engineId}, {"token", engineToken}, …}.dump());
```

The browser reads it and keeps it: `packages/engine-browser/src/probe.ts` stores it in
`RankedEngine.token`, because that is what it must present to the registry to select that engine.

So the token is readable by whoever the engine already lets drive: the machine, the relay, and the
devices the musician paired. The port listens on the LAN — the supervisor starts the engine with
`STUDIO_ENGINE_HOST` set to `0.0.0.0`, where the binary's own default is `127.0.0.1` — but on a
rehearsal network or a venue's wifi, an unpaired device learns only that an engine is there. The LAN
path is unencrypted `ws://`, so a device that can sniff the network still sees a key or the token go by.

## What the token does prove

It is not useless, and removing it would be a regression. It answers one precise question:
**"is this engine, presenting itself under this id, the one that registered?"**

`verifyToken` stops a look-alike from passing for an already-known engine — a second process
announcing the same id cannot produce the token the first deposited with the registry. The token
is an **unguessable identifier**, not a secret: anti-confusion, not anti-intrusion. It protects
against collision and against mistake, not against somebody already on the network.

## The real trust model

What the audio axis assumes, stated plainly:

- **The musician's machine is trusted.** The engine, the supervisor and the file service run on
  the machine of the person playing.
- **The local network is not**: a device on it drives once the musician has paired it, which is what
  lets a phone drive the transport from the stage without letting the whole room do so.
- **The real authentication is elsewhere**: the session cookie st0 mints, which pl8, k7 and z0
  only verify.

None of that is absurd for a stage tool. What would be absurd is writing it backwards in the file
somebody reads before adding a surface.

## What it would take for the token to become a real secret

Half of it is done: `whoami` gives the token only to a socket the engine already trusts — the
machine, the relay, a paired device. What is left is that a paired device still receives it, and
that the LAN path carries it unencrypted. Taking the token out of `whoami` altogether would need the
browser to present a registry ticket instead (`issueEngineTicket` / `verifyEngineTicket` in
`proxy.ts`, the relay's machinery), and the file service to stop taking the token as its gate.

See `docs/constat.md` for where this sits in the whole.
