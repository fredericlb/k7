# k7 served by a machine's own backend

The same bundle is served by a server (`app.k7.rocks`), by the tray on a computer (`http://127.0.0.1:18789`),
and by the phone apps. On the tray's backend, the page is the whole app: there is no shell around it, no
preload, and the browser's address bar is right there. What differs is asked of the backend, never of a build
flag (`src/localApp.ts`).

| choice | why |
|---|---|
| `GET /api/local`, answered by a machine's own backend only | the backend knows what it is; the answer also says whether it runs the engine and which release the tray ships |
| nobody signed in becomes the local user (`AuthGate` → `/auth/local`) | the machine works signed out; a sign-in screen there would be a dead end offline |
| sign-in is the backend's own `/auth/login` | the page is in a browser with its address bar, the case the system-browser hand-off exists to recreate in an app; the OIDC client accepts the loopback redirect |
| pairing with a server offered after sign-in, started by a click (`src/tabs/browserAccount.ts`) | the server's pairing page opens in a tab of its own, which a browser only allows from a click; the page then waits on the backend's pairing, which ends when that tab comes back (`packages/file-hub/docs/syncRelay.md`) |
| no tab for a server the backend pairs with at once (`directHosts`, asked ahead by `prepare`) | an account signed in here through the server's own provider has proved itself already: the backend pairs directly, and a tab is only ever opened inside the click, so the page must know before it (`packages/file-hub/docs/syncRelay.md`, "Pairing without the browser") |
| ONE active server, the others saved and switched in the settings (`src/settings/ServersSection.tsx`) | everything that talks to a server talks to the active one: sync, the home page, the médiathèque, the engines. Adding a server makes it active; "Use this server" switches; the workspaces of the others wait on the machine, hidden (`packages/file-service/docs/liveCapture.md`, "One server at a time") |
| the account bar names the active server, `host · account`, as a link to the settings (`src/projects/ActiveServer.tsx`) | several accounts may be saved on one server; the bar says which one the page is reading, and where to change it |
| the engine page over HTTP (`src/settings/desktopEngine.ts`) | the backend runs the supervisor (`apps/k7/backend/docs/localEngine.md`); the page reads its snapshot as events and sends allowed commands |
| the server this machine syncs with read from `/api/sync/remote` (`src/desktop.ts`) | the user menu's apps and the catalogue's link are that server's, not this backend's |
| the tray's server picker names the active server `host · account` (`src/components/SidebarServer.tsx`) | several accounts may be saved on one server, and the pages it switches to read the active one's |
| the active server's engines listed beside this machine's, `· via <server>` (`serverEngines.md`) | the person's other machines heartbeat to the server they added; the page drives them through that server, its files that server's copy |
| a server already saved, added again, is a pairing that asks which account (`addAccount`, `src/settings/ServersSection.tsx`) | the server's page then names who the browser is signed in as and offers another account; an account already saved there is told, naming both k7's account here and the server's (`account.status.alreadyLinked`) |
| the local user saves servers too | a link names its remote account itself, so signed out is no reason to sync nowhere |
| a phone app answers these itself | its shell already signs in, pairs and drives its engine natively; the page asks it, not the backend. The settings list its servers to switch, and add none: the app offers its first one at sign-in |
| a server's page names no server and saves none (`src/projects/AccountBar.tsx`) | it IS the server its devices pair with: its backend refuses to add one (`packages/file-hub/docs/syncRelay.md`, "A server"), and its sign-in is the user menu's |

The service worker the hosted build registers serves on the tray too: it makes the page installable, and the
backend being on the same machine is what makes it work offline. A phone app's view registers none
(`src/appMain.tsx`) and drops any it holds: its files already sit on the device, served from loopback, and a
precache would copy them to flash again at every first start and every update, while the app starts. The
phone shell is what is installed, so nothing is lost.
