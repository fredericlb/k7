# The main server's engines, on a machine's own backend

A machine's own backend — the tray's, the phone's, the iPhone's (`standalone.md`) — holds a registry
that lists only the engines heartbeating to IT: its own machine's. The person's other machines heartbeat
to the server they added (`packages/engine-registry/docs/ownership.md`), so a tablet paired with
`app.k7.rocks` would never see the desktop that is the same account's there. So this backend also asks
its account's MAIN server which engines that server lists for the link's account, and the page offers
them next to its own, each named `<machine> · via <server>` (`../../frontend/docs/serverEngines.md`).

Two halves, as for the server picker (`serverPicker.md`): this backend lists (`src/remote/serverEngines.ts`,
`GET /api/server-engines`), and the server's device door lets the registry's driving routes in
(`src/remote/door.ts`, `ALLOWED_EXACT`).

## Choices

| choice | why |
|---|---|
| the list asked by this backend, through the device door with the link's token | the page has no session on the server (`serverPicker.md`, "The page never talks to the server itself"); the door turns the token into the link's account for one request, and the server's own `/engines` answers as it does for that account's browser |
| only the MAIN link | the forward, the libraries and the médiathèque's server copy all follow the main link (`packages/file-hub/docs/syncRelay.md`); a page that drove an engine through a secondary would open that link's files under the main link's identity. Making another link main switches the list |
| only `owner`, `shared` and `server` engines | what the account may claim there; an `unowned` engine is a stranger's machine the server lists to everyone, and from another server it is noise nobody can select |
| `via` on each entry, `rtc` dropped | `via` is what tells the page to dial that server's relay and claim there; a WebRTC offer goes to the relay's origin behind its session, which the page does not hold |
| one answer kept 5 s per link, asked at most 4 s | the page lists on every probe and relook; a relay ticket lives a minute, so a 5 s old one is still good, and a slow server must not hold the local list it is merged with |
| an unreachable or refusing server lists none of its engines | an engine through a server is only drivable while that server answers: its relay and its claim are there. `reachable: false` says why the list is short, and nothing stale is offered |
| an engine both registries list is this machine's | the page merges by id, the local route first (`packages/engine-browser/docs/access.md`): the tray on the desktop sees its own engine once, reached on loopback |

## The door's three registry routes

`GET /api/engines`, `POST /api/engine/select` and `POST /api/engine/release`, matched exactly and by
method. The prefixes stay closed: below `/api/engines` are the ownership routes (shares, giving an engine
up, the admins' list), which change who may use a machine and stay behind a real session, and
`/api/engine/<id>/rtc` is not needed. The relay itself is a WebSocket upgrade, which crosses no door: the
page dials `wss://<server>/api/engine/<id>/ws?ticket=…` with the ticket the server minted.

## What this exposes, and what it does not

A device token already signs in as its person for that person's files, stems and songs. Letting it list
and claim adds driving the engines that same account may drive on that server — no other. The server
mints each ticket for the token's account, binds it to one engine for a minute, and `select` applies the
ownership and claim rules unchanged (`packages/engine-registry/docs/claim.md`); the relay gate asks that
account's claim on every frame (`packages/engine-registry/docs/proxy.md`). Nothing on this backend relays an
engine, and nothing composes an address: the server's registry is the only source of where an engine is.
