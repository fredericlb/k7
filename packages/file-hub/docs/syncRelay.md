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

## A machine pairs with the origin, per account

A machine's hub serves several accounts at once — a computer's local user beside the signed-in one —
so where an account syncs is the ACCOUNT's, never the process's: `<account folder>/.sync-remote.json`
(`../syncRemote.ts`) holds the origin's relay URL and the device token, and the hub hands them to that
account's service alone. The local user's workspaces would otherwise land in the signed-in
account's rooms.

The token comes from the origin's `GET /api/sync/devices/pair`, which a computer or a phone opens in
the browser: it signs the browser in when it must, mints a device token named after the
machine, and redirects to a loopback `return` (`isLoopbackReturn`, the same rule as the API
token's pairing) — or to another server's, once the person allowed it (below). A machine whose
account is signed in to the origin's own identity provider gets the same token with no browser, from
`POST /api/sync/pair/direct` (below, "Pairing without the browser"). A paired account's service starts with the hub and is never stopped for idleness,
and pairing restarts it so it dials the new relay.

## Pairing without the browser

An account signed in on the machine through the provider the server signs in with has proved who it
is already: sending the person through the server's page to prove it again is a tab, a redirect and a
click for nothing. So the machine's backend keeps the provider's access token of that sign-in
(commons `packages/oidc/docs/session.md`, "Keeping the provider's token") and, when "Add a server" is
pressed, tries the server's direct route before the browser (`../directPair.ts`). The token the
server mints, the device record and its name, and the link stored on the machine are the browser
pairing's, through the same code (`devices.mint`, `storeLink` in `../pairRoutes.ts`): the two ways
differ only in how the account is proved.

| case | way |
|---|---|
| a signed-in account, a server in the machine's `STUDIO_DIRECT_PAIR_SERVERS`, a kept token | direct; on any refusal, the browser, transparently |
| the local user, "Add another account", a server not in the list, a backend restarted since the sign-in | the browser, always |

**What the server trusts** is its own provider's word, and nothing the caller says about itself:

- the token is checked by the server's provider, never one the caller names: an `issuer` other than
  the server's is refused before the token is sent anywhere;
- the email is UserInfo's, as at the server's own sign-in, and one the provider says it never verified
  (`email_verified: false`) is refused; the person is UserInfo's `sub`;
- the token must have been issued to a client in `STUDIO_PAIR_CLIENTS` (the machine's public client,
  `st0-desktop`). The client comes from the provider's introspection when the server's own client may
  introspect (it needs a secret, and the provider an endpoint), and introspection says `active` and the
  same `sub`; otherwise from UserInfo's `azp` (or `client_id`). A provider that says neither cannot
  have its client checked, and every token is then refused. **Without `STUDIO_PAIR_CLIENTS` the route is
  not mounted at all**: a server never takes a provider token by default, and a provider token issued
  to an unrelated app on the same provider buys nothing.

**What it does not take**: no session cookie (the call is server to server, from the machine's backend,
so no CORS and no `Origin`), and no detail on a refusal — every one is `401` with the same sentence,
the reason staying in the server's knowledge. Five attempts a minute per address (`req.ip`, behind the
proxy the session already trusts), then `429`.

**What the machine trusts the server with**: the token is a bearer for the person at the provider, and
a server that received it could replay it at another server on the same provider to mint itself a
device of that account. So the machine sends it only to the servers its env names
(`STUDIO_DIRECT_PAIR_SERVERS`, `app.k7.rocks` in `standalone.json`), never to an address merely typed,
never through a redirect, and over https (`normalizeServer` admits http only on loopback).

**Where the token lives**: in the machine's backend's memory, never in its session cookie, which is
signed and readable, nor on disk; it dies with the process, and a pairing after a restart takes the
browser. A phone's view, signed in from the system browser through the handoff, shares that browser
session's token by its key (`apps/k7/backend/docs/handoff.md`). An access token lasts what the
provider gives it (`expires_in`, typically an hour): past it, with no refresh token kept, the pairing takes the
browser too. Asking the provider for `offline_access` (in `OIDC_SCOPES`) would keep a refresh token and
renew it, if the provider's client allows that scope.

**The page opens no tab for it.** A browser lets a page open a tab only inside the click, so the page
asks ahead which servers pair at once (`directHosts` on `GET /api/sync/remote/pair`) and opens none for
them; a direct attempt refused afterwards opens the server's page then, and a browser that blocks that
late tab is told so (`account.status.pairBlocked`), the next click opening it first. The answer to the
POST is the pairing already ended (`url: null`), so the phones skip their browser the same way.

## Pairing through the browser is the machine's backend's

A computer under the tray, the Android app and the iPhone app pair the same way, and the way is written once, in
the backend they all run (`../pairRoutes.ts`, `../pairingStore.ts`). What stays in each host is what
only it can do: open the browser (a Custom Tab, an `ASWebAuthenticationSession`, or on a computer a
new tab opened from a click in k7's account bar), ask the person first, and say how it ended
(`apps/k7/frontend/docs/localApp.md`, `engine/k7-runtime/docs/android.md`, `engine/k7-runtime/docs/ios.md`).

- **The browser comes back to the backend's own port**, `SYNC_PAIR_RETURN_PATH` on `127.0.0.1`. No
  app opens a listener of its own: the backend is already a loopback HTTP server, and the phone's port
  is fixed (`apps/k7/backend/docs/standalone.md`), so a return still lands after the app was killed
  behind the browser and started again.
- **The return carries no session, and the state is its gate.** The system browser holds no cookie of
  this backend. A 128-bit state, minted when the app starts the pairing, names the pairing and through
  it the account; a return without a waiting pairing of that state is answered 404.
- **The link takes the account the browser comes back as.** The origin says whose token it minted
  (`identity`), and that is the link's remote account (`as`), whoever it is: syncing as another account
  is a choice, never a mismatch. The choice is made on the origin's page (below), not here. The one
  refusal is that account on that server linked already: the pairing ends `alreadyLinked`, and the link
  it has is kept as it is — re-pairing would swap a working token for a new one for nothing.
- **The origin asks which account whenever it is a choice** (`../pairConsent.ts`): k7 passes the
  account it expects (`as`), and the origin's page shows itself when the browser is signed in as someone
  else, when the person is adding another account (`choose`), and always for the local user, who has no
  account anywhere. The page names the account the token would be for, and offers "Use another account":
  a same-origin POST that ends the origin's session (the backend's `signOut`) and sends the browser back
  to the same pairing through the sign-in. That sign-in carries `prompt=login`, so an identity provider
  that keeps its own session still shows its sign-in page instead of handing back the same account
  (commons `packages/oidc/docs/session.md`). The person expected, already signed in, goes straight
  through, as before.
- **The machine's local user pairs too.** A link names its remote account itself, so the local user's
  workspaces sync into the account the person picked on the origin's page, in the local user's own
  folder, and no signed-in account's rooms are involved.
- **The relay is reached where the person named the server** (`wss://<server>/api/sync`), not at the
  host the origin reported: a proxy in front of it may show the origin another host, and a pairing
  stored with that host would be redone at every sign-in.
- **A pairing under way is on disk**, `<data root>/.sync-pairing.json`, one per account, replaced by
  the next one started. Android may kill an app whose activity is behind the browser; the backend
  dies with it, and finds the pairing again at its next start. An ending nobody was there to see is
  kept a day, so the app says it at its next start and, once paired, hands the token to the phone's
  supervisor. The token itself is in `.sync-remote.json` only.
- **The app waits by long poll** (`GET /api/sync/remote/pair/<state>?wait=`), on the session it already
  has, and drops the pairing once it has said the ending (`DELETE`), which is also the account bar's Cancel.
  Ten minutes without a return is `expired`.

**A machine's account SAVES servers, and uses ONE: the active one.** Each saved server is a LINK, one
account on one server: the relay, the device token, and the remote account `as`; `.sync-remote.json`
is their list (`{ servers: [...] }`, each entry marked `active`). A file holding one pairing rather
than a list reads as that pairing, active; an entry marked `main` reads as marked `active`; an entry
with no `as` is the local account's own on that server.

- **A link is (host, account), and its id is derived from both** (`linkId`: the first 10 hex of a
  sha256), never stored: a server renamed under `currentStudioUrl` keeps every id in step, and the pages,
  the workspace records and the routes all name a link by it. Two accounts on one server are two links;
  the same account again replaces its own link's token.
- **Exactly one link is active while the list is not empty**, and everything that talks to a server talks
  to it: live sync (`STUDIO_SYNC_URL`/`STUDIO_SYNC_TOKEN`, and the one entry of `STUDIO_SYNC_SERVERS`
  with its id and `as`), the libraries, the surfaces that compare themselves with "the" remote
  (`remoteOf`: the médiathèque's server copy, the page forward, favorites, practice and rehearsal
  publications, a moment's consolidation), the server engines listed beside the machine's own, and the
  machine's engine itself (below). One source of "the server" is what keeps a page from opening one
  server's files under another account's identity.
- **The other saved links are named, not used** (`STUDIO_SYNC_HIDDEN`): their workspaces stay on disk,
  hidden and not syncing, and come back when their server is active again
  (`packages/file-service/docs/liveCapture.md`, "One server at a time"). Each link is marked `home` when
  it is its host's local-account link, which is the link a workspace recorded before accounts belongs to.
- **Adding a server makes it the active one** — a pairing, or `PUT /api/sync/remote` — and keeps the
  others saved. `POST /api/sync/remote/active` (`{ id }`, or a `url` naming that server's first link)
  switches; `DELETE /api/sync/remote?id=` forgets one link, `?url=` every link on a server, and nothing
  every one. Forgetting the active link makes the next saved one active. Each of them restarts the
  account's service, which is how sync moves to the new link.

## The engine follows the account

On a machine (the tray), the active server is also where its engine goes: the server that minted the
device token is the one the engine should be the account's on (`packages/engine-registry/docs/ownership.md`).
The supervisor keeps one token per origin, and the engine is listed at the ACTIVE server only. So every
change of the saved servers is compared before and after (`engineMoves` in `../syncRemote.ts`): the
server the active link left is unlisted (`onForgotten(origin)`, `weburi.remove`), and the active link's
server is listed with its token when that token changed (`onPaired(origin, token)`, `weburi.pair`,
`apps/k7/backend/src/localEngine/followPairings.ts`). Another account on the same server hands the
engine that account's token; forgetting a server that is not active moves nothing. A second add of the
active server answers 409 and lists the engine back there with its token — what re-adding a server from
the engine page means after the engine was removed from it alone. The phone's supervisor is handed the
token by the pairing's answer (`token`, the active link's).

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
