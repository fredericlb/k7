# Projects — pl8 held the register, and no longer does

**This service knows nothing about git.** It held an account's list of repositories, the single
deploy key and the libraries pointer; all three moved to the machine that holds the working copies.
The page is kept at this path because eight others link to it, and a reader following one of those
links should arrive at the truth rather than at a 404.

## Where each half went

| was pl8's | is now |
|---|---|
| `/api/projects` — the register of SSH URIs | **nothing**. A project is a folder on the machine that holds it |
| `/api/projects/by-name` — short name → URI | **nothing**. There is one address, `@local`, and it names a folder |
| `/api/projects/ssh-key` — the deploy key, both halves | the file service MAKES its own: `GET`/`POST /ssh-key` (`packages/file-service/src/sshKeys.ts`) |
| `/api/projects/libraries` — the libraries pointer | the file service: `GET`/`PUT /account/libraries`, stored beside the workspaces |

## Why it left

The old reason for holding it was that a repository belongs to a person rather than a machine, and
that this service outlives every engine. That was true and it was traded away deliberately: nothing
needs to outlive the machine any more, and the price of the arrangement was a register that had to
be consulted before a project could be opened, a portable address that only resolved while a server
answered, and a private key that travelled between two services to make either work.

What the studio gets back is that a machine with no server is not a degraded one. An imported
repository is the same thing as a project made locally: a folder, with an `origin` if it has one,
opened at `/@local/<espace de travail>/<projet>`. The gate asks nobody's permission —
`apps/st0/frontend/docs/projects.md` is the page for what replaced this.

## What this service still holds

The médiathèque, the shares (`shares.md`), preferences, sessions, and the `email → subject`
directory the shares need (`projects/identities.ts`, which survived the removal because it is
identity and never was git).
