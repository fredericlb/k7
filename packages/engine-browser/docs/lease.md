# Holding an engine "in use"

`select` does not mark an engine busy. It **renews** a lease that expires on its own.

`packages/engine-registry/registry.ts` stores `assignedSeen`, a timestamp, and reads an engine
as assigned only while `now - assignedSeen < ENGINE_ASSIGN_TTL_MS`. That is deliberate: the
holder is a browser tab, and a tab can be closed, crash, or be put to sleep. Nothing can be
relied on to say goodbye, so the registry forgets by itself and the holder has to keep saying
"still me".

## The bug this shape exists to prevent

A surface that calls `select` once looks correct. Everything works — the engine goes busy, the
picker shows it, the session drives it. Fifteen seconds later the lease lapses and the engine
reads **FREE in everyone's picker, including the holder's own**, while it is still playing.

Nothing errors. No request fails. The only symptom is somebody else picking an engine that was
already in use, which surfaces far from here as two services fighting over one machine.

Two apps shipped that exact bug independently:

- the médiathèque, where fifteen seconds into auditioning a module its engine went back to free;
- m9, whose deck took the lease once and had no `release` in its api client at all — so a deck
  mid-set read as available.

l8' `EngineGate` had renewed from the start. Three copies of one loop, one of which was
missing, is what moved it here.

## What a caller supplies

`holdEngine` takes the two calls rather than making them, because each service reaches **its
own** backend under its own path prefix — `/l8/api`, `/api` (st0 has none), `/m9/api` — and each
holds its own registry (see `packages/engine-registry/docs/shared.md`). The loop is the shared
part; the address is not.

`release` is typed as returning nothing and is called fire-and-forget. Use `navigator.sendBeacon`
for it, not `fetch`: a fetch issued during `pagehide` is cancelled with the page, which is
precisely the moment the goodbye matters. The beacon still is not a guarantee — that is what the
TTL behind it is for.

It carries the engine's **token**, like `select`. A session says who is asking, not which engine
they hold: with an id alone, any logged-in user could drop anyone else's lease on any engine,
and the holder would read FREE in every picker while still driving it. The refusal is silent and
answers 200 — the caller is a page already leaving, so there is nobody left to read a status, and
an unreleased lease simply expires, which is the behaviour it was built for.

## The StrictMode detail

`renew()` runs immediately rather than waiting for the first interval tick. React's StrictMode
mounts, unmounts and remounts in dev; the unmount runs the cleanup, which releases. Without the
immediate re-claim the engine would sit released until the first interval fired.
