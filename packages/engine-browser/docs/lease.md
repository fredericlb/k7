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

It is a shape easy to get wrong in each surface separately, which is why the loop lives here
rather than in any of them.

## What a caller supplies

`holdEngine` takes the two calls rather than making them, because the registry's address is the
caller's to know — k7's backend, which each app derives from its own origin (see
`packages/engine-registry/docs/shared.md`). The loop is the shared part; the address is not.

`release` is typed as returning nothing and is called fire-and-forget. Use `navigator.sendBeacon`
for it, not `fetch`: a fetch issued during `pagehide` is cancelled with the page, which is
precisely the moment the goodbye matters. The beacon still is not a guarantee — that is what the
TTL behind it is for.

It carries the engine's **token**, like `select`. A session says who is asking, not which engine
they hold: with an id alone, any logged-in user could drop anyone else's lease on any engine,
and the holder would read FREE in every picker while still driving it. The refusal is silent and
answers 200 — the caller is a page already leaving, so there is nobody left to read a status, and
an unreleased lease simply expires, which is the behaviour it was built for.

## An expiry recovers; a theft does not

The three refusals to renew (`packages/engine-registry/docs/claim.md`) are not equivalent, and
the loop reports only two of them.

- `project` and `engine` — **somebody** took the project, or the machine. Terminal: `onLost`
  fires, the interval stops, the surface stops driving and says so. Retrying here means taking
  the project out of the hands of a person working on it, and five seconds later they take it
  back out of ours. A surface that keeps its page open meanwhile stops its socket with
  `EngineLink.hangUp()`, which also drops the outbox: what was queued for that project must not
  reach the engine once someone else's project is on it.
- `lapsed` — **nobody** took anything. The server answers this only when nothing holds that
  project *and* nothing else holds that engine: the secret simply aged, over a sleep or a
  dropout. The loop forgets the dead secret and the next tick reopens — a `select` with no
  secret, always granted, which takes nothing from anyone.

Treating `lapsed` like the other two gives a dead screen: "this tab let go of the project", a
button back to the home page, and the user reopening by hand what they never closed. The socket
reconnects by itself (`reliability.md`) and redeclares its session; the claim has to do the
same, so that waking from sleep hands control back without a gesture.

**The next tick, not straight away.** An engine that has left the registry answers `lapsed` too:
reopening on the heels of the 409 would spin as fast as the network allows. Waiting
`ENGINE_ASSIGN_RENEW_MS` bounds recovery to five seconds and the hammering to nothing.

One round trip's race remains: between the 409 and our reopening, somebody can open the project,
and an opening always wins. It is the same window as a page reload's, and it beats the dead
screen it replaces.

## The StrictMode detail

`renew()` runs immediately rather than waiting for the first interval tick. React's StrictMode
mounts, unmounts and remounts in dev; the unmount runs the cleanup, which releases. Without the
immediate re-claim the engine would sit released until the first interval fired.
