# Engines through the active server

On a machine's own backend (the tray, the phone and iPhone apps — `localApp.md`), the engine lists show
this machine's engines and, after them, the ones the account's ACTIVE server lists for that link's
account, each named `<machine> · via <server>`: a tablet in the app finds the desktop that is the same
account's on `app.k7.rocks`. How the backend gets the list is `apps/k7/backend/docs/serverEngines.md`;
the merge, the probe and the claim are `@studio/engine-browser`'s `server` option
(`packages/engine-browser/docs/access.md`, "Engines through a server"), wired in `src/api.ts`.

## Choices

| choice | why |
|---|---|
| asked only where `/api/local` answers (`src/localApp.ts`) | a server's page lists its own registry, which already holds every engine its accounts heartbeat to; the route exists on a machine's backend alone |
| one name everywhere, `engineName` (`src/components/engineWords.tsx`) | the bar's dropdown, the full list and the "Sound on …" line must say the same thing, and `· via <server>` is what tells a person the sound and the files go through that server |
| driven through that server's relay, never directly | the page dials `wss://<server>/api/engine/<id>/ws` with the server's ticket and claims through the backend's forward (`/api/server`), as a browser signed in there would; no LAN address, loopback or WebRTC is tried, so a tablet needs nothing of the engine's network |
| never taken unasked, only when the account remembered it | an engine through a server plays THAT server's files (below), so taking one moves the project; a person's own pick, saved by the picker, is the one thing that does it |
| the project opened again when a pick moves its files (`EngineGate`'s `pick`) | the files switch hubs, and the gate re-points the file API without resolving again (`packages/project-shell/docs/launch.md`); a fresh open is what checks the workspace is there |
| the home page's files stay this machine's (`src/settings/accountFiles.ts`) | the home page lists this machine's workspaces whatever the remembered engine; only a project opened on that engine reads the server's |

## The project's files are the server's copy

An engine through a server gets its project the way it does for any browser at that server: the
server's file hub binds the account's file service to the engine once the claim lands, and copies the
project over the engine's tunnel (`packages/file-hub/docs/fileHub.md`, "An engine is bound by a CLAIM";
`packages/file-service/docs/engineLoad.md`, the `copying` phase). The page therefore opens the project on
the server's hub, through the forward (`/api/server/api/files`, with the server's hub ticket), and edits
that copy; the live-sync relay brings every edit back to this machine's copy.

What follows from it:

- **Only a workspace the active server syncs, under its own name, opens there.** A workspace kept on this
  machine alone, or one brought down as `<room>.<host>` because a folder here held that name, is not on the
  server under the name the address gives: the gate says the project is not found, and choosing this
  machine's engine (the home page's selector) opens it here again.
- **A new file reaches this machine through sync, not at once.** The editor writes the server's copy; the
  local copy follows as the relay delivers.
- **Nothing is ever sent from this machine to that engine.** This machine's file service has no tunnel to
  it, and the engine's machine is never dialled from here.

## What is not covered

- **The médiathèque's player** (`@studio/ui-library`) keeps its own engine list, this machine's.
- **The bench** (`/@banc/…`) takes the engine its account already holds a claim on, in this registry.
- **The other saved servers** list nothing: only the active one is asked.
