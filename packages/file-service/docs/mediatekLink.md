# Where the media library is, seen from an account's file service

Two values — `MEDIATEK_URL` and `MEDIATEK_TOKEN` — that everything calling the media library from this service
depends on: the `/mediatek/*` routes, saving a take into the médiathèque, and sharing a project.

## The hub hands them in, and nothing else does

The file hub starts one service per account (`packages/file-hub/docs/fileHub.md`), and k7's backend is
the process running the hub. So it gives each service its own loopback address and a bearer minted
**for that account** (`apps/k7/backend/src/media/fileHub.ts`). No file on disk is read as a fallback:
the only thing that ever started this service is the hub, and a value found anywhere else would be
some other process's.

Loopback rather than the public origin: the call never leaves the machine, and it does not depend
on the proxy in front of k7 being configured for it.

## The token's subject is the account

A bearer carries only a subject, and the one minted here is the account the service serves. So a
call is that person's, with no service identity to bridge to a person afterwards.

## Sharing goes through the same pair

`Workspace.shareLink` renders the snapshot and posts it to the media library with this same bearer. Sharing needs
no plumbing of its own: this service already talks to the media library with this token.
