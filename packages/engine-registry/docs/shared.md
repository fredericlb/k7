# One registry, and it is the origin's

An engine heartbeats to **one** registry per studio family, mounted by k7's backend
(`apps/k7/backend/src/media/mount.ts`) and answering on k7's origin — `engineRegistryUrl` in
`packages/web-protocol/services.ts`. `play.st0.app` is a former host read as that origin, so a supervisor
that saved `https://play.st0.app` reaches the same registry (`packages/web-protocol/docs/addresses.md`).
The editor, the media library's player, z0's editor and the rehearsal recorder's chain source all
list their engines from it; the last only waits for the engine holding its bench and drives none.

## The problem it solves

The registry answers one question: *which engines can this browser reach?* Every app that drives
an engine asks it — the editor for a song, the media library for a track, z0 for a repository — so
an app without one to consult could only hardcode `127.0.0.1:8765` (`probeLocalEngine`).

## Why one, and why the BROWSER asks it

With one registry per service, an engine would have to be pointed at each of them to be pickable in
each — and the heartbeat count would grow with every service. One registry makes "this engine is
connected to that studio" one fact.

The case against a central registry is that one backend would become a request-time dependency of
another. That coupling does not arise here: no BACKEND asks another. Every page that calls it —
k7's own and z0's editor, served at `/z0` on k7's hostname — calls it same-origin, the relay
included; a credentialed call from any other origin is refused (`apps/k7/backend/docs/media/cors.md`).

## Saying what it is

`GET /api/registry/hello` answers `{ service: "k7-registry" }`, open like the heartbeat. It is how the
supervisor tells a registry from any other website before it sends one the engine's token
(`engine/k7-supervisor/docs/supervisorPolicy.md`); it says nothing else.

## What this costs

The registry is down whenever k7's backend is, and so are the workspaces, since the accounts' file
services are started by the same process (`packages/file-hub/docs/fileHub.md`): that backend down
is the studio down. A registry that is down is absent from every picker, which is right: the
engines cannot be listed.

The remembered engine is the ACCOUNT's: the editor and the media library read and write one
preferences document on k7's backend (`engineId`, the command preferences, the playback
destination), so a machine picked in one is picked in the other.

An engine is still listed once and driven by several apps at once, through separate sessions
(`packages/engine-protocol/docs/sessions.md`).

## One mounting

The registry is mounted in ONE place, k7's backend, and still through one call rather than by hand.
`mountEngineRegistry(app, { service, requireAuth, exitOnSignal, stateDir, isAdmin })` installs the guard, the registry
and the routes, and answers a `serve(server, url)` that attaches the relay after `listen` — the relay
needs the `http.Server`, which Express does not have before then. `stateDir` is where the engines'
secret bindings and owners outlive a restart (`token.md`, `ownership.md`); without it they live in
memory alone. `isAdmin` says who may reset an engine's owner.

The ORDER is the load-bearing part, and that is why this is a function rather than a paragraph:
`requireAuth` goes on the paths meant for the BROWSER **before** the router, so that those meant
for the ENGINE — `heartbeat`, `deregister`, where a machine authenticates with its tunnel secret —
stay open. Written by hand per service, that order would be a rule every file had to keep; let
one of them mount a guard over the whole of `/api` and the only thing still protecting the
heartbeat would be that the router had already answered.

Two things stay out of the base: k7's backend does not parse the file hub's paths at all and
streams their bodies through, so the file service applies its own 8 MB body limit
(`apps/k7/backend/docs/hardening.md`), and the error handler mounted LAST is the backend's own
`jsonErrorHandler`. One drift the base removes by construction:

- **Leaving.** A service that leaves its advertisement file behind points the file service at a
  dead port for ever (`~/.k7/web-endpoints/pl8.json` — the service is still named `pl8` — is how
  a machine's file service finds the médiathèque). The supervisor does not heartbeat to these
  files — an engine joins an instance only when its `registryUrls` names it. By default the base
  installs SIGINT and SIGTERM and exits inside them, with `alsoOnStop` for what a service has of
  its own. A host that has more to stop passes `exitOnSignal: false` and calls the goodbye `serve`
  returns itself: k7's backend does, so the account file services stop and the requests in flight
  drain before the process exits (`apps/k7/backend/docs/media/engine.md`).

## What `assigned` means, and why it is nearly obsolete

`assigned` is a lease: a tab re-POSTs `/engine/select` every few seconds, and the flag
expires on its own because a closing tab can only say goodbye best-effort. It hides an engine
already being driven, from a world where a second driver would destroy the first one's project.

Sessions remove that danger — two apps on one engine hold two projects. The flag survives as
**information** ("someone is on this"). Retiring it is its own decision.
