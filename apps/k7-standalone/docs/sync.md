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
- **Announced before the browser opens.** It is the second trip right after the sign-in's, so a
  native dialog says why first, and the account bar shows it waiting, with Cancel (`docs/notices.md`).
- **Once per account and server per run.** A pairing the person closes is not reopened at every session change;
  the next start asks again.
- **The local user never pairs.** It has no account at the origin.
- **Signing out does not unpair.** The account's workspaces keep syncing while the app runs, whoever
  is signed in to the window. Unpairing is a choice of its own, made in Settings, signed in as that
  account (`DELETE /api/sync/remote`, `apps/k7/frontend/docs/settings.md`); the origin can also
  remove the device, which stops it at its next connection. Signed out, the window is the machine's
  local user, whose workspaces are its own: the account's are not listed, and the home page says so
  beside its Sign in (`AccountBar.tsx`) rather than looking as if they were gone.

## The server is the person's choice

Signing in asks which k7 server this machine syncs with — `app.k7.rocks`, a private instance, a dev
origin — in a popin the home page's Sign in opens before the browser does, prefilled with the last
one (`src/server.ts`, `ServerDialog.tsx`). A popin rather than a field beside the button, and the
same one on the phones (`engine/k7-runtime/docs/android.md`): the address is the one decision a
sign-in asks for, and a field squeezed into the account bar hid it. It is kept in the app's state
folder and is where pairing goes; the sign-in
still goes through the app's own provider. The address is an origin, https unless the server is on
this machine (`normalizeServer` in `packages/web-protocol/pairing.ts`, one rule for the field and the
main process): a device token sent in clear across a network would be given away.

Choosing another server re-pairs at the next sign-in, and the new pairing REPLACES the old one only
once it has come back: a pairing closed half-way leaves the account syncing where it did, never
unpaired. The relay's address is the chosen server's (`wss://<server>/api/sync`), not the one the
origin reports: a proxy in front of it may show the origin another host, and a pairing stored with
that host would be redone at every sign-in. `K7_SYNC_ORIGIN` overrides the choice, for testing.

## Several servers, one of them main

An account may sync with more than one server — its own instance and a band's, say. The server
chosen at sign-in is the **main** one: the account's libraries, the remote surfaces and every new
workspace are its. The others are added beside it from the home page's account bar
(`apps/k7/frontend/src/projects/SyncServers.tsx`), which pairs through the system browser exactly as
sign-in does (`addServer` in `src/pairSync.ts`) and lists each server with **Make main** and a way to
stop syncing with it; the browser must be signed in as the same account on every one. Signing in again
with a server already paired pairs nothing: which one is main is the person's choice, kept by the hub.

The home page lists the workspaces of every server, each naming its own, and a workspace moves from
one to another from its row (`apps/k7/frontend/docs/projects.md`): sent whole, then removed from the
one it left (`packages/file-service/docs/liveCapture.md`, "Several servers").

## What pairing changes in the local hub

The pairing is `<account folder>/.sync-remote.json` (`packages/file-hub/syncRemote.ts`): the
origin's relay URL, the device token and the email. The hub reads it per account when it starts that
account's file service, so only that account dials the origin; the local user's service keeps the
hub's own relay. Pairing restarts the account's service, and a paired account's service starts with
the hub and is never stopped for idleness: a replica that sleeps receives nothing.

Every workspace of a paired account is captured from the service's start, so one made here goes up
to the origin. One the origin has and this machine lacks is NOT brought down on its own: the home
page lists it with a cloud and a Download (`GET /workspaces/sync`, `POST /workspaces/sync/download`),
since a workspace of takes is gigabytes a laptop or a phone may not want. Downloaded, it is created
empty and joined, the relay's first answer fills it, and it stays synced from then on. Each row
says where its workspace lives: synced, on this machine only, or on the server only.

The origin's LIBRARIES are followed too, read-only, with the paired account's token: the hub's
library replica joins each library the desktop lists as `@lib/<name>`, so the bundled copy becomes
the origin's and an edit made here is put back (`packages/file-hub/docs/fileHub.md`).
