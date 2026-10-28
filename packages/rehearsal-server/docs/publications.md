# Releases and pages live on the server alone

Releases, their versions and the pages that list them are kept on the SERVER and nowhere else. A
release is made to be heard by people who are not at the rehearsal, and a page is a public address
(`ownership.md`): both mean something only where everyone can reach them. A copy on a laptop would be
a second release that nobody else can hear, with nothing to reconcile it against the first.

So a LOCAL instance, a desktop or a phone (`K7_INSTANCE=local`, set in
`../../../apps/k7/backend/standalone.json`), keeps none. Its `/api/releases`, `/api/pages` and
`/api/public/pages` are forwarded to the server it is paired with (`../src/publications.ts`). Without
a server, or with one that does not answer, they are refused with a 503 that says which, and the
screens show that sentence instead of the lists (`../../ui-rehearsal/src/components/ServerOnly.tsx`).
The lists are asked for only once that check has found the server, never when the pages load: a
machine with no server would otherwise answer a 503 on every visit, which reads as a fault.
The sessions, their moments and the exercises keep working: they are the machine's own.

## The machine acts as the person who paired it

The server answers a device at `/api/sync/k7`: the same three routers, behind the device token
instead of a session. The person the token names (`../../file-hub/docs/syncRelay.md`) stands in for
the signed-in user, so a release made from a desktop belongs to that person on the server, exactly
as if it had been made in a browser there. A token from before tokens named a person reaches none of
it, and says to pair again.

The session's cookie never travels to the server; the device token does. An upload streams through
without being held, and a track played from a release streams back the same way, Range included.

## What is not held up

On a local instance, the forwarded routes go before the store's own gate. They read nothing local,
so a store that is still importing, or failed to import (`store.md`), does not stop them. The gate
itself covers the rehearsal paths alone: k7's backend serves its other `/api` routes from the same
process, and they wait on none of this.
