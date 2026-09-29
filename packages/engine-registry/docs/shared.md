# One registry, and it is pl8's

An engine heartbeats to **one** registry per studio family: pl8's, on its own subdomain
(`play.<st0 host>`, or `:8795` on a loopback dev host — `engineRegistryUrl` in
`packages/web-protocol/services.ts`). st0 holds none. Its browser lists engines from pl8
directly, as z0's always has, so an engine registered with `play.st0.app` is registered with
`st0.app` as well. k7 does not drive an engine and consults nothing.

## The problem it solves

The registry answers one question: *which engines can this browser reach?* Every app that drives
an engine asks it — st0 for a song, pl8 for a module preview, z0 for a repository — so an app
without one to consult could only hardcode `127.0.0.1:8765` (`probeLocalEngine`).

## Why pl8's, and why the BROWSER asks it

With one registry per service, an engine would have to be pointed at each of them to be pickable in
each — adding st0 in the tray would leave pl8's picker empty — and the heartbeat count would grow
with every service. One registry makes "this engine is connected to that studio" one fact.

The case against a central registry is that one backend would become a request-time dependency of
another. That coupling does not arise here: no BACKEND asks another. st0's page calls pl8's
routes across the origin (pl8 answers every origin's credentialed request — `apps/pl8/docs/cors.md`),
the relay included, exactly as it already calls pl8 for the médiathèque.

## Saying what it is

`GET /api/registry/hello` answers `{ service: "st0-registry" }`, open like the heartbeat. It is how the
supervisor tells a registry from any other website before it sends one the engine's token
(`engine/st0-supervisor/docs/supervisorPolicy.md`); it says nothing else.

## What this costs

st0's engine picker is down whenever pl8 is. A registry that is down is absent from the picker,
which is right: the engines cannot be listed. So are the workspaces, since the accounts' file
services run inside pl8 (`packages/file-hub/docs/fileHub.md`): pl8 down is the studio down, whatever
st0 says.

The remembered engine stays each APP's: st0 passes `prefsBase` to `engineAccess`, so its preference
document — the engine id and its command prefs — is still its own backend's, not pl8's.

An engine is still listed once and driven by several apps at once, through separate sessions
(`packages/engine-protocol/docs/sessions.md`).

## One mounting

The registry is mounted in ONE place, pl8, and still through one call rather than by hand.
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
- **Leaving.** A service that leaves its advertisement file behind points the file service at a
  dead port for ever (pl8's file is how it finds the médiathèque). The supervisor no longer
  heartbeats to these files — an engine joins an instance only when the user adds it in the tray. The base installs SIGINT and SIGTERM, and `alsoOnStop` is there for what a service
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
