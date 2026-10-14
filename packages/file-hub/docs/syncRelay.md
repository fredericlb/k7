# The live sync relay

`syncRelay.ts` orders the batches of every replica of an account's workspace and relays them, at
`/api/sync` on st0's backend. The ordering itself is `@studio/live-sync`'s Room
(`../../live-sync/docs/sync.md`). The plan is `../../../docs/live-sync-plan.md`, phases 3, 5 and 6.

## In the hub, and authenticated by the hub's own secret

The replicas today are this hub's file services. Each already holds a secret the hub minted for it,
and the hub knows the account behind each secret (`instances.bySecret`). So a file service dials the
relay with the same `x-studio-hub-secret` it answers the hub with, and the relay knows its account
without a new credential. The hub hands every service the relay's address as `STUDIO_SYNC_URL`. A
service dials it unless `STUDIO_LIVE_SYNC=0`. A machine proves its account with a device token.

## One socket per file service, every workspace on it

A file service serves all of an account's workspaces, so one socket carries them and each message
names its workspace. The relay keeps one Room per account and workspace, loaded on its first hello.

## A machine pairs with the origin, per account

A machine's hub serves several accounts at once — a desktop's local user beside the signed-in one —
so where an account syncs is the ACCOUNT's, never the process's: `<account folder>/.sync-remote.json`
(`../syncRemote.ts`) holds the origin's relay URL and the device token, and the hub hands them to that
account's service alone. The local user's workspaces would otherwise land in the signed-in
account's rooms.

The token comes from the origin's `GET /api/sync/devices/pair`, which a desktop opens in the system
browser: it signs the browser in when it must, mints a device token named after the machine, and
redirects to a loopback `return` only (`isLoopbackReturn`, the same rule as the API token's pairing).
The desktop's side is `apps/st0-standalone/docs/sync.md`. A paired account's service starts with the
hub and is never stopped for idleness, and pairing restarts it so it dials the new relay.

## Every workspace a replica, and the rooms say which exist

A file service captures every workspace from its start, not only those a request opens: one never
opened would otherwise neither send nor receive. On each connect it asks `GET /api/sync/rooms`
(`../roomsRoute.ts`, the same token or secret as the socket) which workspaces the account has. The
origin's own service creates and joins the ones it lacks at once, since the server holds them all; a
paired machine only lists them, and joins one when the person downloads it
(`../../../apps/st0-standalone/docs/sync.md`). Either way the relay's first answer fills it. A room left with no file — a workspace removed everywhere — is not offered, so the
machine that removed it does not bring it back. `Examples` is never synced: every build stocks its
own on every replica.

The same token also reads the origin's médiathèque, read-only, at `/api/sync/mediatek`; `deviceGate`
in `../syncRoutes.ts` is that gate (`../../mediatek/docs/serverCopy.md`). A token minted from a session also names
the PERSON, the OIDC subject who paired: an account can be shared, and the songbook offers a device
the private songs of that person alone (`../../rehearsal-server/docs/songbookCopy.md`). A token minted
before that names nobody and is offered public songs only, until the machine pairs again. The same person
is who a moment shared from the machine belongs to on the origin (`../../rehearsal-server/docs/momentShare.md`).

## On disk BEFORE it is relayed

Each ordered entry is appended to `entries.jsonl` before any replica hears of it. Every 200 entries
the room is saved whole to `room.json`, its open conflicts with it, and `entries.jsonl` is rolled
into a segment of the room's permanent log, `log/<firstSeq>.jsonl`; every 1,000 the files are also
kept whole under `snapshots/`. Loading a room is the saved state plus `entries.jsonl` replayed; the
segments, the snapshots and `checkpoints.json` are the workspace's history (`history.md`), never
read to catch up.

A restore from the history is submitted to the same live room the sockets feed, through the same
path as a replica's batch, so it is on disk before it is relayed like any other entry.

The order matters because of what a replica does on reconnecting. It says hello at the last `seq` it
applied. A room that forgot entries it had already relayed would be BEHIND that replica, and would
send it the room's older state to adopt, overwriting edits the replica had seen confirmed.

Rooms live in the account's folder, `<STUDIO_FILES_ROOT>/<account>/.sync-relay/<workspace>/`, beside
the account's file-service state and outside every workspace.

## In front of the other upgrade listeners

It installs itself in front of the existing `upgrade` listeners, as the rehearsal room does
(`../../rehearsal-server/src/rtc.ts`). The engine registry's listener closes an upgrade it does not
recognise when it is the only listener.

## Change notices for the browsers

Every entry the relay orders is announced to the account's open pages over Server-Sent Events, at
`/api/sync/events` behind the session (`../syncEvents.ts`). A page then rereads what it shows at once,
where it would otherwise wait for its next `/revision` poll.

- **SSE, not the sync WebSocket.** The page only listens: it has nothing to send. An EventSource rides
  the session cookie with no ticket, passes the proxies a plain response passes, and reconnects by
  itself. A browser is not a replica, so it is kept off the socket that carries ops.
- **A notice names what moved, never what it became**: the workspace, the entry's `seq`, the files it
  touched, how many ops it set aside (`parked`) and how many conflicts it settled (`settled`). The page
  reads the files through the file hub as it always does, so the stream adds no second path to a
  file's contents and no second permission check.
- **Per account, in this process.** The relay and the browsers' streams are both st0's backend, so the
  fan-out is a set of open responses per account; a comment every 20 s keeps an idle stream through a
  proxy's timeout, and an account may hold 32 streams at most, one per tab.
- **A lost notice costs speed, not correctness.** Nothing is replayed to a page that reconnects: the
  page asks `/revision` on reconnecting and keeps a slow poll, which is the source of truth.
