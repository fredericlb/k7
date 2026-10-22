# Ownership — whose engine it is, and who else may use it

Registration is open unless the studio asks a heartbeat to prove a paired machine (`heartbeat.md`). A claim
says which project an engine drives for whom (`claim.md`), and the tunnel secret says which
machine an id is (`token.md`). Neither says whose engine it is. Ownership does.

## The rule

An engine belongs to the account its **heartbeat proves**. Other accounts may use it only if the
owner **shared** it with them, by email or with **everyone** on this server. Two engines need no
owner at all: the server's own — `server`, its tunnel proved by the render key
(`packages/engine-tunnel/docs/jobs.md`) — and an engine on this backend's own machine.

| role (`PublicEngine.access`) | listed | relay ticket, token through the relay | `select` |
|---|---|---|---|
| `owner` | yes | yes | yes |
| `shared` | yes, with `ownedBy` | yes | yes |
| `server` | yes | yes | yes |
| `unowned` | yes, LAN addresses only to its own network (`sameSourceIp`) | no | **403** `unowned` |
| anyone else | **no** — no name, no address | no | **403** `not-yours` |

Between accounts that may use an engine, the claim rules are unchanged: the newcomer still displaces
(`claim.md`). An anonymous session — no email, no subject — can neither own nor claim.

The account is spelled as `claimHolder` spells it (the session's email, else its subject), so the
owner check and every claim check compare one name. Shares are emails, compared lowercase.

## How an engine gets an owner

From its heartbeat. A supervisor that added this server holds a **device token** the server minted
for the account that added it (`packages/file-hub/docs/fileHub.md`), and sends it with every
heartbeat. `deviceOf` turns it into that account's email, and the engine is that account's from the
first heartbeat on: no open, no approval, nothing the person does twice.

An open never makes an owner. Holding the token proves only that a browser reached the machine —
any account signed in on any browser there, which is how a stub dev account or a guest's session
would end up owning a musician's engine. The machine's own credential is the stronger statement.

A heartbeat proving another account than the recorded one **moves** the engine: the new owner starts
with no shares, and every claim of an account that may no longer use it ends at once. A heartbeat
that proves nothing, or proves the render machine, changes no record; such an engine stays unowned,
usable only by the two rules that need no owner.

## An engine on this backend's own machine is every account's on it

An engine whose heartbeat came from loopback runs on the machine this backend runs on: the tray's or
the phone's own engine, a developer's in a dev session, a server's next to it. Several accounts sign
in there — an app's local one before any other, then the person's real one, or the functional
suite's — and the machine is theirs alike. So such an engine is `owner` to every signed-in account
(`engineRole`, in `owners.ts`, the one rule the listing, a select and the relay apply), whatever its
record says, and its record is left as it is for every other backend it beats to.

"Came from loopback" is any heartbeat in the last 15 s (`onThisMachine`, `registry.ts`), not the
last one: a supervisor may list the same backend twice, once on `localhost` and once through a
reverse proxy whose address is all the second heartbeat shows, and the engine would flip between
everyone's and its owner's every few seconds.

## Sharing and giving up

Behind the session, under `/api/engines` (`ownershipRoutes.ts`):

| route | who | does |
|---|---|---|
| `GET /engines/:id/shares` | the owner, an admin | `{ owner, shared, everyone, since }` |
| `PUT /engines/:id/shares` `{ emails, everyone? }` | the owner | replaces the list (at most `MAX_SHARED`), and the flag when given; a removed account's claims end now |
| `DELETE /engines/:id/owner` | the owner, an admin | the record goes; the next proven heartbeat assigns it again |
| `GET /engines/owners` | an admin | every record |

Anyone else gets `404 not-yours` from the first three — the same answer as for an engine nobody
owns, so a stranger cannot probe which ids are owned. An admin is `isAdmin` as the host defines it;
k7 passes `isAdminRequest` (`AUTH_ADMIN_GROUPS`, `apps/k7/backend/src/media/admin.ts`).

**Everyone** is a flag beside the list rather than a list of every account, so an account created
after the share is included without the owner editing anything. Absent from a `PUT`, it stays as
it was: a client that only edits the emails does not withdraw it.

In k7 the Engines card of `/settings` (`packages/ui-library/src/EnginesSettings.tsx`) badges each
engine with its role and gives the owner the share list and the way to give it up; the picker
(`apps/k7/frontend/src/components/EngineSelect.tsx`) shows the same badge.

## What inherits it

Every server route that reaches an engine for an account asks for a claim (`claim.md`, "The claim
is what lets the server reach an engine"), and only an account that may use the engine gets one. So
the file hub's binding, a stem cut, a song brought down for the player, a WebRTC offer and the
relay's driving frames are all ownership-gated through `select`. A claim taken before a share was
withdrawn, or before the engine moved, is evicted with it.

A browser that loses a claim this way is told `ClaimLost` with reason `refused`
(`packages/engine-browser/src/registry.ts`), and the lease stops for good rather than retrying.

## Where it is kept

`engine-owners.json` beside `engine-bindings.json` in the host's state dir (`mount.ts`, k7's is
`<mediatek>/.engines`): written whole and atomically, 0600, set aside when unreadable
(`stateFile.ts`). Capped at `MAX_OWNED` ids, the oldest record going first. Without a state dir it
lives in memory.

A record with no proven heartbeat behind it is kept until one names another account: dropping it
would leave an engine nobody can use through the relay until its supervisor holds a device token.
