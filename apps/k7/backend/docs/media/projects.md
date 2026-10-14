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
