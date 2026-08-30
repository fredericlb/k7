# The per-engine token: what it proves, and what it does not protect

**The per-engine token does not stay server-side.** That sentence must not be written the other
way round: a false security claim is worse than no claim, because people build on it.

## What actually happens

The engine answers `whoami` — **on any socket, with no prior authentication** — with its id, its
token and its audio timing:

```
// engine/moteur/server/main.cpp, the `whoami` / `hello` branch
ws.send(json{{"type", "whoami"}, {"id", engineId}, {"token", engineToken}, …}.dump());
```

The browser reads it and keeps it: `packages/engine-browser/src/probe.ts` stores it in
`RankedEngine.token`, because that is what it must present to the registry to select that engine.

So anyone who can open a WebSocket to the engine's port has the token. And that port is not
necessarily local — the supervisor starts the engine with `STUDIO_ENGINE_HOST` set to `0.0.0.0`
(`packages/engine-client/src/engineDaemon.ts`), where the binary's own default is `127.0.0.1`. On
a rehearsal network or a venue's wifi, the token is readable by the room.

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
- **The local network is trusted too**, by default, because of the `0.0.0.0`. That is what lets a
  phone drive the transport from the stage, and it is the same hole.
- **The real authentication is elsewhere**: the session cookie st0 mints, which pl8, k7 and z0
  only verify.

None of that is absurd for a stage tool. What would be absurd is writing it backwards in the file
somebody reads before adding a surface.

## What it would take for the token to become a real secret

A design lot, not a fix — it is not taken:

1. `whoami` returns the token only to an already-authenticated socket, or stops returning it and
   the registry learns it by another channel (the supervisor knows it already: it is what
   registers the engine).
2. The browser presents a **ticket** issued by the registry rather than the token — the machinery
   exists for the relay (`issueEngineTicket` / `verifyEngineTicket` in `proxy.ts`), and it is
   exactly the right shape.
3. `STUDIO_ENGINE_HOST` goes back to `127.0.0.1` by default, LAN exposure becoming an explicit
   choice rather than a silent default.

Point 2 is the closest: half the path is written, and no test covers it today (`proxy.test.ts`
only exercises the relay's HTTP path).

See `docs/constat.md` for where this sits in the whole.
