# Why every service holds its own registry

An engine heartbeats to a **list** of registries, and each hosted service keeps its own
in-memory copy. That is deliberate; the two obvious alternatives are both worse.

## The problem it solves

The registry answers one question: *which engines can this browser reach?* Every service that
drives an engine asks it — st0 for a song, pl8 for a module preview — so a service without one
has nothing to consult and can only hardcode `127.0.0.1:8765` (`probeLocalEngine`).

Hardcoding loopback is defensible while a preview *has* to play on the machine the module
lives on. It stops being defensible the moment the user is asked to **choose** an engine per
service, which is the point of the whole arrangement.

## Why not one central registry the others query

Because then st0-backend is a dependency of pl8-backend, at request time, for the
list a user sees on first load. A st0 deploy would take pl8's engine picker down with
it, and the two are deployed separately on purpose. The registry is 120 lines of `Map` — the
coupling would cost far more than the duplication.

## Why not one registry per *machine*

The registry is consulted by a **browser**, over the public internet, before it knows any
engine. It has to live where the browser already is: same origin, behind the same session.

## What this costs

The engine sends N heartbeats every 5 s instead of one. Each is a small POST with a 1500 ms
bound and no retry, and a registry that is down is simply absent from that service's picker
— which is exactly right, because that service genuinely cannot be driven right now.

An engine is therefore listed in several services at once, and **that is the intended
state**: one machine, one audio interface, several apps driving it through separate sessions
(`packages/engine-protocol/docs/sessions.md`).

## One registry per service, but a single mounting

Every service holds its registry; none has a reason to hold its own **mounting**.
`mountEngineRegistry(app, { service, requireAuth })` installs the guard, the registry and the
routes, and answers a `serve(server, url)` that attaches the relay after `listen` — the relay
needs the `http.Server`, which Express does not have before then.

The ORDER is the load-bearing part, and that is why this is a function rather than a paragraph:
`requireAuth` goes on the paths meant for the BROWSER **before** the router, so that those meant
for the ENGINE — `heartbeat`, `deregister`, where a machine authenticates with its own token —
stay open. Written by hand per service, that order would be a rule every file had to keep; let
one of them mount a guard over the whole of `/api` and the only thing still protecting the
heartbeat would be that the router had already answered.

Three drifts the base removes by construction:

- **The body limit.** The relay makes these backends a pipe to the file service, which accepts
  8 MB. Raised in one service and not the other, the same request passes or answers 413
  depending on which origin the browser sends it from. It is `ENGINE_BODY_LIMIT`, one number.
- **The error handler.** A body that stops arriving throws **inside** the parser, where no
  route's `try/catch` sees it, and every service relays the same bytes. It is
  `engineErrorHandler`, to be mounted LAST.
- **Leaving.** A service that leaves its advertisement file behind is beaten towards a dead port
  for ever. The base installs SIGINT and SIGTERM, and `alsoOnStop` is there for what a service
  has of its own — st0 puts its legacy file there, because the base exits the process inside its
  handlers and a second one registered afterwards would never run.

## What `assigned` means, and why it is nearly obsolete

`assigned` is a lease: a tab re-POSTs `/engine/select` every few seconds, and the flag
expires on its own because a closing tab can only say goodbye best-effort. It hides an engine
already being driven, from a world where a second driver would destroy the first one's project.

Sessions remove that danger — two apps on one engine hold two projects. The flag survives as
**information** ("someone is on this"), and per-service registries mean it does not even span
services: st0's registry knows nothing about the pl8 tab holding the same engine. Retiring it
is its own decision.
