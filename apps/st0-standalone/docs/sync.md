# The desktop as a replica of the origin's account

A signed-in desktop holds the account's workspaces and keeps them in step with the origin's through
live sync's relay (`docs/live-sync-plan.md`, `packages/file-hub/docs/syncRelay.md`). The desktop's
own backend runs a hub like the origin's; what makes one of its accounts a replica of the origin is
a PAIRING stored for that account.

## Pairing goes through the system browser, once per account

Sign-in leaves the desktop holding a session with its LOCAL backend only: nothing it has proves the
account to the origin. So after a sign-in, `src/pairSync.ts` asks the local backend whether that
account is paired (`GET /api/sync/remote`) and, when it is not, opens the system browser on the
origin's `/api/sync/devices/pair`. The origin signs the browser in if it must, mints a device token
for the account (named after the machine), and redirects it to a loopback port this process
listens on, the way sign-in does (`docs/signIn.md`).

- **The token never passes through a window.** A page could be anything; the main process receives
  it on loopback and hands it to the local backend (`PUT /api/sync/remote`) through the app's own
  session, which is how the backend knows which account it is for.
- **The browser must be signed in as the same account.** The origin says whose token it minted
  (`identity`), and a different email is refused: that account's workspaces would otherwise sync
  into this one.
- **Once per account per run.** A pairing the person closes is not reopened at every session change;
  the next start asks again.
- **The local user never pairs.** It has no account at the origin.
- **Signing out does not unpair.** The account's workspaces keep syncing while the app runs, whoever
  is signed in to the window; `DELETE /api/sync/remote`, signed in as that account, unpairs it.

`ST0_SYNC_ORIGIN` points pairing at another origin, for testing.

## What pairing changes in the local hub

The pairing is `<account folder>/.sync-remote.json` (`packages/file-hub/syncRemote.ts`): the
origin's relay URL, the device token and the email. The hub reads it per account when it starts that
account's file service, so only that account dials the origin; the local user's service keeps the
hub's own relay. Pairing restarts the account's service, and a paired account's service starts with
the hub and is never stopped for idleness: a replica that sleeps receives nothing.

Every workspace of a paired account is captured from the service's start, and the service asks the
origin which workspaces the account has (`GET /api/sync/rooms`): one it lacks is created empty and
joined, and the relay's first answer fills it. That is how an existing workspace arrives on a new
machine.

A device token reaches only its own account's rooms, so the origin's LIBRARIES are not synced here:
the desktop keeps the library it bundles (`docs/standalone.md`).
