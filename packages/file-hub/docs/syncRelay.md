# The live sync relay

`syncRelay.ts` orders the batches of every replica of an account's workspace and relays them, at
`/api/sync` on k7's backend. The ordering itself is `@studio/live-sync`'s Room
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

## A machine signs in to ONE server, and signing in is pairing

A machine (the tray, a phone) has one account of its own, its local user, and syncs with at most one
server. `<local user's folder>/.sync-remote.json` (`../syncRemote.ts`) holds that server's relay URL,
the device token and the account it was minted for (`as`); the hub hands them to the local user's
service alone. Who the person is at the server is the link's, never the machine's session: the
machine's backend turns any other session into the local user (`apps/k7/backend/src/server.ts`), since
a session that expires would otherwise take the link, and the workspaces, with it.

| choice | why |
|---|---|
| the server signs the person in, on its own page in the system browser | the machine needs no client at any identity provider, so any server works, whatever provider it uses; and identity providers refuse a WebView (RFC 8252 §8.12) |
| a FRESH sign-in there is the consent: the pairing URL carries a `challenge`, and the server's gate sends a session older than five minutes through `/auth/login?prompt=login` first (`apps/k7/backend/src/media/fileHub.ts`) | the person typing their password now is the yes; a page to confirm after it is a second click for one act. Without the fresh sign-in, any program on the machine could open the URL in a browser already signed in and get a token silently |
| the server sends back a one-use code, never the token (`../pairCodes.ts`, `../pairSignIn.ts`) | a code read off the redirect, the browser's history or another app catching the scheme is worth nothing without the verifier |
| the machine's backend trades it with its verifier, PKCE S256, at `POST /api/sync/devices/redeem` | the verifier never leaves the backend: it is made there, kept with the sign-in under way (`.sync-pairing.json`), and sent only to the server the sign-in started at |
| the code lands on the backend's loopback port (`SYNC_PAIR_RETURN_PATH`), or on a phone app's scheme (`<app id>://pair`), which hands it to the backend | the tray's browser tab and a phone's browser sheet each come back where they can; the trade is the backend's either way (`engine/k7-runtime/docs/android.md`, `ios.md`) |
| the return carries no session, and the 128-bit state is its gate | the system browser holds no cookie of the machine's backend |
| a new sign-in REPLACES the link, and each token let go is handed back (`DELETE /api/sync/device`, by that token) | one server at a time; a token kept on the server for a link the machine forgot is a device listed for nothing |
| signing out is forgetting the link (`DELETE /api/sync/remote`): its token is handed back, the engine leaves the server, sync stops; the files stay | what came down is the person's, on their machine |
| a sign-in under way is on disk, one per account, kept a day once ended | Android may kill an app behind the browser, and the backend with it: the return still lands at the next start, and the ending is said then |
| the page waits by long poll (`GET /api/sync/remote/pair/<state>?wait=`) and drops the record once told (`DELETE`), which is also the Cancel | ten minutes without a return is `expired` |
| the relay is reached where the person named the server (`wss://<server>/api/sync`), not at the host the server reported | a proxy in front of it may show the server another host |

The link names one server, and everything that talks to a server talks to it: live sync
(`STUDIO_SYNC_URL`/`STUDIO_SYNC_TOKEN`), the libraries, the surfaces that compare themselves with "the"
remote (`remoteOf`: the médiathèque's server copy, the page forward, favorites, practice and rehearsal
publications, a moment's consolidation), the server engines listed beside the machine's own, and the
machine's engine itself (below). A file holding several links reads as its active one first;
`POST /api/sync/remote/active` and `PUT /api/sync/remote` remain for a link made by hand.

## Pairing without the browser

Machines on an older k7 pair by sending their provider access token to `POST /api/sync/pair/direct`
(`../directPair.ts`), which a server mounts only when `STUDIO_PAIR_CLIENTS` names the clients it takes
tokens from (`PAIR_CLIENTS` in the hosted stack's `.env`). The server trusts its own provider's word and
nothing the caller says: the issuer must be its own, the email UserInfo's and verified, the client one
of the list (introspection's, else UserInfo's `azp`, `client_id` or sole `aud`). Every refusal is the
same `401`, the reason in the server's log; five attempts a minute per address, then `429`.

## The engine follows the account

On a machine (the tray), the active server is also where its engine goes: the server that minted the
device token is the one the engine should be the account's on (`packages/engine-registry/docs/ownership.md`).
The supervisor keeps one token per origin, and the engine is listed at the ACTIVE server only. So every
change of the saved servers is compared before and after (`engineMoves` in `../syncRemote.ts`): the
server the active link left is unlisted (`onForgotten(origin)`, `weburi.remove`), and the active link's
server is listed with its token when that token changed (`onPaired(origin, token)`, `weburi.pair`,
`apps/k7/backend/src/localEngine/followPairings.ts`). A sign-in as another account hands the engine
that account's token, and signing out unlists it. The phone's supervisor is handed the token by the
sign-in's answer (`token`, the link's).

The token is the sync's: one device of the account's list, so revoking that device on the server ends
both the sync and the ownership. The active servers are listed once, when the backend first starts (a
marker under the files root), and never again: a server the engine was removed from keeps syncing
without being listed back.

## A server

A server is the remote its devices pair with, and adds no server of its own: `POST` and `GET
/api/sync/remote/pair`, `PUT /api/sync/remote` and `POST /api/sync/remote/active` answer 403 with a
sentence saying so (`SERVER_ADDS_NONE`), and `GET /api/sync/remote` lists no server. Its accounts sync
with its own relay only, by the hub secret: `syncTarget` (`../syncRemote.ts`) ignores whatever
`.sync-remote.json` an account's folder holds there, so a pairing stored on a server is not used and
its file is left in place, as are the workspaces it brought down, which stay listed and sync with
nothing. The engines that heartbeat to the server are its accounts' to drive as they always are
(`packages/engine-registry/docs/ownership.md`). What a server does take is a device's pairing:

- **A machine's sign-in is sent a code, with no page to confirm**, once the person signed in there in the
  last five minutes (above). A return that is neither loopback nor a phone app's scheme is refused.
- **The token is minted on a click of the server's own page when the return is another server's https**
  (`../pairConsent.ts`, `isServerReturn`). A loopback return reaches the machine that asked, but an
  https one reaches whoever wrote the link: without the click, a link sent to someone signed in there
  would hand their account to the sender. The page names the asking server and the account, offers
  another account as a machine's does, cannot be framed, and its Allow is a same-origin POST, which
  another site cannot forge.

## The relay trusts the socket, not the payload

A frame is checked whole before anything reads it (`readToRelay`, `../../live-sync/docs/ops.md`), and
one that does not read is answered with its reason; a hello at a level this relay does not serve is
answered `refused` (`../../live-sync/docs/sync.md`, "Versions"). A frame must also be well formed:
every op of a batch has the shape its kind gives it and a path that stays in the workspace. A room's
name is a single folder name (`isWorkspaceName`), or `@lib/` and a library name, since it becomes a
folder under `.sync-relay/`. Anything else is answered `{ t: "error" }`, and so is a throw while a
frame is handled: a socket is one replica, and must not be able to stop the process every account
shares. For the same reason an upgrade whose address does not parse is left to the other listeners,
and a line of `entries.jsonl` that does not parse is skipped on load — the last one, cut short by a
crash, was never relayed. A line written by a newer log version is not skipped: the room refuses to
load.

## Every workspace a replica, and the rooms say which exist

A file service captures every workspace from its start, not only those a request opens: one never
opened would otherwise neither send nor receive. On each connect it asks `GET /api/sync/rooms`
(`../roomsRoute.ts`, the same token or secret as the socket) which workspaces the account has. The
origin's own service creates and joins the ones it lacks at once, since the server holds them all; a
paired machine only lists them, and joins one when the person downloads it
(`../../../apps/k7/frontend/docs/projects.md`). Either way the relay's first answer fills it. A room left with no file — a workspace removed everywhere — is not offered, so the
machine that removed it does not bring it back. `Examples` is never synced: every build stocks its
own on every replica.

The same token also reads the origin's médiathèque, read-only, at `/api/sync/mediatek`; `deviceGate`
in `../syncRoutes.ts` is that gate (`../../mediatek/docs/serverCopy.md`). A token minted from a session also names
the PERSON, the OIDC subject who paired: an account can be shared, and a moment shared from the
machine belongs to that person on the origin (`../../rehearsal-server/docs/momentShare.md`).

## On disk BEFORE it is relayed

Each ordered entry is appended to `entries.jsonl` before any replica hears of it. Every 200 entries
the room is saved whole to `room.json`, its open conflicts with it, and `entries.jsonl` is rolled
into a segment of the room's permanent log, `log/<firstSeq>.jsonl`; every 1,000 the files are also
kept whole under `snapshots/`. Loading a room is the saved state plus `entries.jsonl` replayed; the
segments, the snapshots and `checkpoints.json` are the workspace's history (`history.md`), never
read to catch up.

The room takes an entry only once its append succeeded (`Room.submit`'s `persist`): on a full disk
or an I/O error the room is left exactly as it was and the sender hears an error, so its retry is a
new entry with the same seq rather than a duplicate the room "knows" and never writes. A whole-room
save that fails is logged and retried at the next one, since the entries it covers are on disk
already; the idle timer and the stop catch the same way, room by room, because a throw there ends
the backend.

A room nobody is joined to, untouched for ten minutes and with its automatic checkpoint taken, is
saved and dropped from memory; the next hello loads it as a restart would. Without that, every
workspace ever opened stayed resident with its texts, its 2,000-entry log and its text bases, for
the life of the process. The entries stay appended synchronously: on disk before relayed is what
the paragraph above promises, and an append is cheap beside the whole-state save every 200.

A restore from the history is submitted to the same live room the sockets feed, through the same
path as a replica's batch, so it is on disk before it is relayed like any other entry.

A replica's link reconnects after a jittered, doubling wait, and pings the relay itself: the relay's
own ping ends sockets it no longer hears, but only the replica can tell that its socket went
half-open — a laptop that slept, a Wi-Fi that changed — while it would otherwise go on sending into
nothing and read as current.

The order matters because of what a replica does on reconnecting. It says hello at the last `seq` it
applied. A room that forgot entries it had already relayed would be BEHIND that replica, and would
send it the room's older state to adopt, overwriting edits the replica had seen confirmed.

Rooms live in the account's folder, `<STUDIO_FILES_ROOT>/<account>/.sync-relay/<workspace>/`, beside
the account's file-service state and outside every workspace.

## In front of the other upgrade listeners

It installs itself in front of the existing `upgrade` listeners. The engine registry's listener closes an upgrade it does not
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
- **Per account, in this process.** The relay and the browsers' streams are both k7's backend, so the
  fan-out is a set of open responses per account; a comment every 20 s keeps an idle stream through a
  proxy's timeout, and an account may hold 32 streams at most, one per tab.
- **A lost notice costs speed, not correctness.** Nothing is replayed to a page that reconnects: the
  page asks `/revision` on reconnecting and keeps a slow poll, which is the source of truth.
