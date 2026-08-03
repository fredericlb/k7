# Why every service holds its own registry

An engine heartbeats to a **list** of registries, and each hosted service keeps its own
in-memory copy. That is deliberate; the two obvious alternatives are both worse.

## The problem it solves

The registry answers one question: *which engines can this browser reach?* Until now only
pistes asked it, so it lived in pistes' backend. Then mediatek's module preview and platines'
deck started driving engines too — and both had the question hardcoded to `127.0.0.1:8765`
(`probeLocalEngine`), because there was no registry of theirs to consult.

Hardcoding loopback was defensible while a preview *had* to play on the machine the module
lives on. It stops being defensible the moment the user is asked to **choose** an engine per
service, which is the point of this whole line of work.

## Why not one central registry the others query

Because then pistes-backend is a dependency of mediatek-backend, at request time, for the
list a user sees on first load. A pistes deploy would take mediatek's engine picker down with
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

## What `assigned` means now, and why it is nearly obsolete

`assigned` is a lease: a tab re-POSTs `/engine/select` every few seconds, and the flag
expires on its own because a closing tab can only say goodbye best-effort. It exists to hide
an engine already being driven, from a world where a second driver would have destroyed the
first one's project.

Sessions removed that danger — two apps on one engine now hold two projects. The flag
survives as **information** ("someone is on this"), and per-service registries mean it no
longer even spans services: pistes' registry knows nothing about the mediatek tab holding the
same engine. Retiring it is its own decision, not a side effect of this move.
