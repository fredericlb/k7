# k7 served by a machine's own backend

The same bundle is served by a server (`app.k7.rocks`), by the tray on a computer (`http://127.0.0.1:18789`),
and by the phone apps. On the tray's backend, the page is the whole app: there is no shell around it, no
preload, and the browser's address bar is right there. What differs is asked of the backend, never of a build
flag (`src/localApp.ts`).

| choice | why |
|---|---|
| `GET /api/local`, answered by a machine's own backend only | the backend knows what it is; the answer also says whether it runs the engine and which release the tray ships |
| the machine's session is ALWAYS its local user (`AuthGate` → `/auth/local`; the backend turns any other into it) | the machine works signed out, and one account folder holds its workspaces whether it is signed in to a server or not; who the person is at the server is the link's |
| on a first launch with no server saved, a prompt: connect to one by its address, or stay offline (`src/projects/ServerPrompt.tsx`) | a machine works offline, so a server is offered, not required. "Remind me next time" comes ticked and asks again at the next launch (a browser session); unticked, only the settings connect from then on |
| signing in to ONE server is linking to it, started by a click (`src/tabs/connectServer.ts`, `src/tabs/browserAccount.ts`) | the server's sign-in opens in a tab of its own, which a browser only allows inside the click, and the fresh sign-in there is the consent: no page to confirm (`packages/file-hub/docs/syncRelay.md`, "A machine signs in to ONE server"). A phone app opens it in its browser sheet (`engine/k7-runtime/docs/android.md`) |
| signing out is the settings' Server section (`src/settings/ServersSection.tsx`), where the user menu's Sign out leads | it says what stays: the workspaces, the downloaded songs and the recordings stay on the machine; the server forgets the device |
| no account bar over the workspaces | signing in lives in two places, the first-launch prompt and the settings; a bar over the list would be a third |
| the user menu's heading is the account at the server, or "Local" with none (`src/projects/menuAccount.ts`) | the machine's own user is nobody's login: the menu says which account the page is reading |
| the engine page over HTTP (`src/settings/desktopEngine.ts`) | the backend runs the supervisor (`apps/k7/backend/docs/localEngine.md`); the page reads its snapshot as events and sends allowed commands |
| the server this machine syncs with read from `/api/sync/remote` (`src/desktop.ts`) | the user menu's apps and the catalogue's link are that server's, not this backend's |
| the active server's engines listed beside this machine's, `· via <server>` (`serverEngines.md`) | the person's other machines heartbeat to the server they added; the page drives them through that server, its files that server's copy |
| a server's page asks nothing and saves no server (`src/projects/ServerPrompt.tsx`, `src/settings/ServersSection.tsx`) | it IS the server its devices pair with: its backend refuses to add one (`packages/file-hub/docs/syncRelay.md`, "A server"), and its sign-in is the user menu's |

The service worker the hosted build registers serves on the tray too: it makes the page installable, and the
backend being on the same machine is what makes it work offline. A phone app's view registers none
(`src/appMain.tsx`) and drops any it holds: its files already sit on the device, served from loopback, and a
precache would copy them to flash again at every first start and every update, while the app starts. The
phone shell is what is installed, so nothing is lost.
