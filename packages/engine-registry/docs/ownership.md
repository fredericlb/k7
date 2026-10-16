# Ownership — whose engine it is, and who else may use it

Registration is open: any machine heartbeats an engine with no account (`heartbeat.md`). A claim
says which project an engine drives for whom (`claim.md`), and the tunnel secret says which
machine an id is (`token.md`). Neither says whose engine it is. Ownership does.

## The rule

An engine belongs to the account that **enrolled** it. Other accounts may use it only if the owner
**shared** it with them. The server's own engine — `server`, its tunnel proved by the render key
(`packages/engine-tunnel/docs/jobs.md`) — is usable by every account and is never owned.

| role (`PublicEngine.access`) | listed | relay ticket, token through the relay | `select` |
|---|---|---|---|
| `owner` | yes | yes | yes |
| `shared` | yes, with `ownedBy` | yes | yes |
| `server` | yes | yes | yes |
| `unowned` | yes, LAN addresses only to its own network (`sameSourceIp`) | no | an open with its token enrols the caller |
| anyone else | **no** — no name, no address | no | **403** `not-yours` |

Between accounts that may use an engine, the claim rules are unchanged: the newcomer still displaces
(`claim.md`). An anonymous session — no email, no subject — can neither own nor claim.

The account is spelled as `claimHolder` spells it (the session's email, else its subject), so the
owner check and every claim check compare one name. Shares are emails, compared lowercase.

## How an engine gets an owner

By its first **direct** open. The token is what `select` takes, and the browser reads it from the
engine's `whoami`. Three places answer one: the engine's own machine, a paired LAN device
(`engine/k7-runtime/docs/pairing.md`), and the server's relay. The relay withholds it
(`relayGate.ts`, `withoutToken`) from every account that may not use the engine, which includes
everybody while the engine has no owner. So holding the token of an unowned engine means this
browser reached it directly: it sits on that machine or on a network the musician paired it to.
The first `select` that OPENS (no claim secret) with that token makes the caller the owner, and
drops whatever claims other accounts held on it.

There is no separate enrol route: an open that presents the token is the enrolment, and it needs
nothing the probe does not already do (`packages/engine-browser/src/probe.ts`). A RENEWAL never
enrols, so an owner who gives the engine up from one tab is not made owner again by that tab's next
renewal.

The heartbeat carries no account: the supervisor holds no session and no library token, a desktop's
sync pairing being the app's and not the supervisor's. So an engine is never owned at registration.

On an HTTPS page only loopback is dialled directly (`packages/engine-browser/docs/access.md`). The
first open of an engine is therefore made from a browser on its own machine, or over plain HTTP on
its network. After that, the owner reaches it from anywhere, through the relay.

## Sharing and giving up

Behind the session, under `/api/engines` (`ownershipRoutes.ts`):

| route | who | does |
|---|---|---|
| `GET /engines/:id/shares` | the owner, an admin | `{ owner, shared, since }` |
| `PUT /engines/:id/shares` `{ emails }` | the owner | replaces the list (at most `MAX_SHARED`); a removed account's claims end now |
| `DELETE /engines/:id/owner` | the owner, an admin | the engine is unowned again |
| `GET /engines/owners` | an admin | every record |

Anyone else gets `404 not-yours` from the first three — the same answer as for an engine nobody
owns, so a stranger cannot probe which ids are owned. An admin is `isAdmin` as the host defines it;
k7 passes `isAdminRequest` (`AUTH_ADMIN_GROUPS`, `apps/k7/backend/src/media/admin.ts`).

Giving an engine up hands it to the next account that opens it with its token. That includes every
account it was ever shared with, since they read its token through the relay while they could.

In k7 the Engines card of `/settings` (`packages/ui-library/src/EnginesSettings.tsx`) badges each
engine with its role and gives the owner the share list and the way to give it up; the picker
(`apps/k7/frontend/src/components/EngineSelect.tsx`) shows the same badge.

## What inherits it

Every server route that reaches an engine for an account asks for a claim (`claim.md`, "The claim
is what lets the server reach an engine"), and only an account that may use the engine gets one. So
the file hub's binding, a stem cut, a song brought down for the player, a WebRTC offer and the
relay's driving frames are all ownership-gated through `select`. A claim taken before a share was
withdrawn is evicted with it.

A browser that loses a claim this way is told `ClaimLost` with reason `refused`
(`packages/engine-browser/src/registry.ts`), and the lease stops for good rather than retrying.

## Where it is kept

`engine-owners.json` beside `engine-bindings.json` in the host's state dir (`mount.ts`, k7's is
`<mediatek>/.engines`): written whole and atomically, 0600, set aside when unreadable
(`stateFile.ts`). Capped at `MAX_OWNED` ids, the oldest record going first. Without a state dir it
lives in memory.

## Engines registered before ownership existed

They have no record, and are listed `unowned` until one account opens one directly. A token is a
long-lived value: an account that holds one — read on a device paired once, or through a relay
older than this gate — can enrol that engine first while it is unowned. An admin resetting the owner
undoes that; a fresh `engine-id.json` on the machine (a new id and token) ends it for good.
