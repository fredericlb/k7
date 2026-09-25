# Who a file service's workspaces belong to

**Only the server holds workspaces**, and there each one belongs to exactly one account. An
engine's machine holds none: it is shared by every account that plays on it — one at a time,
whoever holds its claim — and it plays **copies** of the server's files, per account, under
`<state>/remote/<server>/` (`packages/engine-tunnel/docs/tunnel.md`).

The same file service runs in both places, so what decides is the mode (`hosted.ts`).

## On the server: one account per process, recorded

The file hub runs one process per account, each over its own root
(`packages/file-hub/docs/fileHub.md`). Each of those records its owner in
`<state>/owner.json`: the first account to reach a workspace- or account-shaped route claims it,
with an exclusive create, and **any other account is refused with a 403**. The hub already keeps
accounts apart; the record is what makes a mistake there — a key two accounts share — fail closed
rather than hand one account's workspaces to another. The email is compared exactly.

It sits **beside** the root and never in it: an absent root is what seeds a new account's
Examples, and a record written inside it would make every account look old.

The engine session a root's projects play in is named after its owner, set from the record at
boot and by the gate — never by whoever made the last request.

## On an engine's machine: no workspace routes

Every workspace- and account-shaped route answers **404** there, whoever asks: `/workspaces*`,
`/engine/served`, `/account/*`, `/ssh-key`, and every route that resolves a workspace. There is
nothing to own, so nothing is recorded.

What stays on an engine's machine is what belongs to the **machine**, for every account alike: its
copy of the médiathèque, its speakers, its plugin scan, and the separations a hosted service asks of
it — as jobs over the tunnel, with no file service there.

The server is where a project lives, so pl8 refuses to start without `$STUDIO_FILES_ROOT`
(`packages/file-hub/docs/fileHub.md`).
