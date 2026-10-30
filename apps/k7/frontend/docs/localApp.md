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
| the engine page over HTTP (`src/settings/desktopEngine.ts`) | the backend runs the supervisor (`apps/k7/backend/docs/localEngine.md`); the page reads its snapshot as events and sends allowed commands |
| the server this machine syncs with read from `/api/sync/remote` (`src/desktop.ts`) | the user menu's apps and the catalogue's link are that server's, not this backend's |
| a phone app answers these itself | its shell already signs in, pairs and drives its engine natively; the page asks it, not the backend |
| a server's page pairs too, with no sign-in control (`src/projects/AccountBar.tsx`) | an account there may sync with other servers beside the one it is signed in to, which stays the main one (`packages/file-hub/docs/syncRelay.md`, "A server's accounts"); its sign-in is the user menu's |

The service worker the hosted build registers serves on the tray too: it makes the page installable, and the
backend being on the same machine is what makes it work offline. A phone app's view registers none
(`src/appMain.tsx`) and drops any it holds: its files already sit on the device, served from loopback, and a
precache would copy them to flash again at every first start and every update, while the app starts. The
phone shell is what is installed, so nothing is lost.
