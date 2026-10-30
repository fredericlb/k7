# Projects — the library holds none

**The media library knows nothing about git.** It keeps no list of an account's repositories, no deploy
key and no libraries pointer: all three belong to the machine that holds the working copies.

| question | who answers |
|---|---|
| which projects does this account have | the file service, from the workspaces on its machine — a project is a folder there |
| how is a project addressed | `/@local/<espace de travail>/<projet>`, naming that folder (`packages/project-shell/docs/launch.md`) |
| the origin's libraries | the file hub: `GET`/`PUT /account/libraries`, one list beside the account folders, `PUT` for admins only (`AUTH_ADMIN_GROUPS`) |

## Why the file service, and not the library

A register here would have to be consulted before a project could open, would give an address that
only resolves while a server answers, and would send a private key between two services to make
either work. With the machine holding all of it, a machine with no server is not a degraded one: an
imported repository is the same thing as a project made locally — a folder, with an `origin` if it
has one. `apps/k7/frontend/docs/projects.md` is the page for the screen that lists them.

## What the library holds

The médiathèque, the shares ([shares.md](shares.md)), and the `email → subject` directory the
shares need (`apps/k7/backend/src/media/projects/identities.ts` — identity, not git;
[sshKeyForService.md](sshKeyForService.md) says why it exists).

## The account's service starts before its first list

A file service is a node process per account, and its cold start — parsing the bundle, then
readying its workspaces — is what the first list of projects would otherwise wait for. So it is
started EARLIER, at a moment that already says a list is coming:

- **On a server, `/auth/me`.** Every page asks who is signed in before it asks for anything else,
  and an answer naming a user starts that account's service (`FileHub.warm`, from `src/server.ts`).
  The hook only reads the answer, after it went out, so it costs `/auth/me` nothing. A service
  already running is merely counted as used.
- **On a phone or the tray, the boot.** The machine has one person, the local user, whose service
  starts once the backend listens — and is never stopped for being idle (`idleMs` infinite in
  `src/media/fileHub.ts`): reaping only frees memory for another account, and there is none, while
  a screen left off for ten minutes would otherwise pay a cold start on the next open.

