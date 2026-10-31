# The machine's engine, run by its own backend

Under the tray (`apps/k7-tray`), this backend runs on the person's computer and runs that computer's
supervisor, and so its engine (`src/localEngine/`). It is off everywhere else: the tray turns it on by naming
the supervisor (`K7_SUPERVISOR_BIN`), and a server's backend or the phone's never runs one.

| choice | why |
|---|---|
| the backend hosts the supervisor, over stdio | the supervisor listens on no port, so no page in the browser can reach it (`engine/k7-supervisor/docs/hostProtocol.md`); k7's pages reach it through this backend's routes |
| `/api/local/engine` behind the session, on a local-user backend only | such a backend answers loopback only and refuses cross-site writes (`standalone.md`); the session is what any other route of it takes |
| an allow-list of commands | a page starts, stops and restarts the engine, ranks the audio interfaces, rescans plugins, fetches or drops instruments, and lists the engine at a server or not; `shutdown`, the pairing verbs and plugin windows are not the page's |
| a server added by pairing the account, not by `weburi.add` | the engine is the account's on a server only through the device token that server minted for it (`packages/engine-registry/docs/ownership.md`); the engine page's Add pairs through the browser, and the file hub's `onPaired` sends `weburi.pair` (`src/localEngine/followPairings.ts`, `packages/file-hub/docs/syncRelay.md`) |
| one token per server, with several accounts linked there | the supervisor holds one per origin, so it is the MAIN link's when the main is on that server, else the first link's there (`engineLinkOf`, `packages/file-hub/syncRemote.ts`); making another link main hands the engine to that account |
| removing a server on the engine page unlists the engine alone | the account keeps syncing with it; "Stop syncing" on the home page lets go of both |
| the pairings made before this, listed once | a marker under the files root, so an engine removed from a server is not listed back at the next start |
| the snapshot pushed as Server-Sent Events | a whole picture every time, as the supervisor emits it; the browser reconnects by itself across a backend restart |
| this backend pinned first in the supervisor's `engine-host.json` before each start | `$STUDIO_REGISTRY_URL` counts only while the file lists no registry, and the page finds the engine in this backend's registry |
| every other loopback registry dropped when pinning | the supervisor reaches any loopback registry at k7's one port, which `STUDIO_PORTS` makes this backend's (`engine/k7-supervisor/src/Url.cpp`): another loopback entry is this backend spelt otherwise, and two hold two tunnels that displace each other. A second k7 on the machine (the dev session's) is listed by its public name |
| the engine opens the backend's own folders by path (`STUDIO_ENGINE_ROOTS`) | a project here is a folder on this disk; nothing is copied through the tunnel |
| the supervisor stopped before the rest | it deregisters from this backend, which must still be up to hear it |
| `/api/local/tray` under a bearer the tray hands over at spawn | the tray has no session; the status line it draws is worded here (`trayStatus.ts`), so it is tested |
| `/api/local` answered by a local-user backend only | its answering at all is how a page knows it is on a machine's own backend (`apps/k7/frontend/docs/localApp.md`) |

Under the tray, stdin closing is the stop (`K7_STDIN_STOP`): Windows has no signal to send, and elsewhere a
dead tray closes the pipe.
