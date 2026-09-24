# One owner per root

A workspace belongs to **exactly one account**, and never to two. The file service holds every
workspace of a root — `<state>/workspace/` — together with what goes with them: the bench, the
Examples, the libraries repository, the cold chains, the deploy key, and the engine session its
projects play in. So the unit that has an owner is the **root**, and every workspace under it is
that owner's.

## The first account claims it, on disk

`<state>/owner.json` records the owner: the first account to reach a workspace- or
account-shaped route writes it, with an exclusive create so two first callers cannot both win.
From then on that account passes and **every other account is refused with a 403**. The refusal
does not name the owner.

It sits **beside** the root and never in it: an absent root is what seeds a new account's
Examples (`workspaces.ts`), and a record written inside it would make every account look old.

The email is compared **exactly**. A slug is not an identity: `a.b@x.org` and `a_b@x.org` fold to
the same one, which is how two accounts could otherwise come to share a folder.

A root that predates the record — a machine's own, from before — is adopted by the first account
that reaches it. On a personal machine that is its owner; on a shared one, delete the
workspaces or give each account its own server-hosted root (`packages/file-hub/docs/fileHub.md`).

## What the gate covers, and what it does not

Gated: `/workspaces*`, `/engine/served`, `/account/*`, `/ssh-key`, and every route that resolves a
workspace. Open: what belongs to the **machine** rather than to an account — its médiathèque
cache, its speakers, its plugin scan, the renders and separations a hosted service asks of it, its
playlist sync targets. A second account may still play a song from the médiathèque on someone
else's machine; it cannot open that someone's workspaces.

## The engine session follows the owner

The engine session a root's projects play in is named after its owner (`sessionOf` in
`engineLink.ts`). It is set from the record at boot and by the gate, never by whoever made the last
request: a second account's call to an open route must not move the owner's song into another
session.
