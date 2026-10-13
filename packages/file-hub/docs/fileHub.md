# The file hub — workspaces on the server

A workspace belongs to its account, not to whichever engine happens to be running. So the
server keeps it: `$STUDIO_FILES_ROOT/<account>/workspace/…`, served at `/api/files` by st0's backend
(`apps/st0/backend/src/media/fileHub.ts`), and
an engine only ever plays a **copy** it fetched through its tunnel
(`packages/engine-tunnel/docs/tunnel.md`). The server is the ONLY place a workspace lives: an
engine's machine is shared by whichever accounts play on it and holds none
(`packages/file-service/docs/owner.md`). So `$STUDIO_FILES_ROOT` is **required**: the backend without
it refuses to start, since the origin it would serve could open no project at all.

## One file-service process per account

The hub does not reimplement the file service: it runs `@studio/file-service` itself, one
process per account with that account's folder as its `$STUDIO_HOME`, and it is the only thing
that ever starts one. A process and not one shared service, because the file service holds one
person's state in module globals — the owner, the watchers, the document a
browser built — and a process boundary is the one isolation nobody can forget to thread through.
The price is a Node process per **active** account; an instance nobody called for 30 minutes is
stopped and starts again, in well under a second, on the next request.

An account's folder is `accountKey(email)`: the readable slug **and** a hash of the exact email,
since a slug alone folds `a.b@` and `a_b@` into one folder. The same key names its copy on an
engine's machine. Behind that, each hosted process records its one owner like any file service
(`packages/file-service/docs/owner.md`), so even a colliding key could not hand one account's
workspaces to another.

A hosted process listens on **loopback only** and its one gate is a secret the hub generated for
it. What only makes sense on an engine's machine is off: CORS (the hub answers the browser), the
machine's speakers (mpv), the médiathèque puller (the library is already on this disk) and the
dial to a local engine at boot.

### In dev, an edit stops them

The backend's `tsx watch` restarts it on an edit to what it IMPORTS, and a spawned process is not an
import: an account's file service would keep running yesterday's `commands` or `song` until
somebody restarted the backend by hand. So with `watchSources` (`STUDIO_FILES_WATCH=1`, set by
`st0-backend`'s dev script and never by the image) the hub watches `@studio/file-service` and every `@studio/*`
package it depends on, transitively, and stops all its instances on a change.

Stopping, not a `tsx watch` child. A child that restarts itself keeps its process, so the hub
would never hear of it, and would go on believing in the engine binding the new process has
never been told about. A stopped instance goes through the ordinary exit — its binding
released — and the next request starts a fresh one, as it does after the idle stop.

## A ticket says who is calling

The browser's identity headers are **dropped**, not trusted: `x-studio-user` is set by the hub,
and the hub secret and engine token a client sends are removed. On an engine's machine the user
header is taken on faith behind the engine token; on a server shared by several accounts that
faith would let anyone open anyone's workspace.

Who it is comes from a **ticket**: `/api/files-hub`, behind the session guard, answers one — the
account's email and an expiry, signed with a key derived from the session secret, so a deploy does
not invalidate an open page. The browser sends it in the header the file service's gate already
reads, which spares every call a cookie across origins; `/api/files` itself has no session
guard, the ticket being its gate, with the session as a fallback for a same-origin caller.
Twelve hours, and the browser asks again after six.

**Whether the caller is an admin rides the same way.** The host passes `isAdmin(req)`. st0's backend checks
the session's OIDC `groups` against `AUTH_ADMIN_GROUPS`, and an empty list admits nobody. The hello
answers `admin`, the ticket signs it, and the hub stamps `x-studio-admin: 1` on what it forwards,
having dropped any copy the client sent. The file service trusts that header for the same reason
it trusts `x-studio-user`: only the hub's secret reaches it. It guards what reaches every account
at once: the libraries list (answered by the hub itself — below), and in the file service every
write into a library (`packages/file-service/docs/libraries.md`). A ticket outlives a group change by up to twelve
hours, the same as it outlives the session.

## The libraries are the hub's

The origin has ONE list of libraries, `<dataRoot>/libraries.json` (`../libraries.ts`), and ONE
folder per library, `<dataRoot>/libraries/<name>`, which every account's file service gets as
`$STUDIO_LIBRARIES_HOME`. One list because a library is the reference every song resolves
`@<name>/…` against; one folder because a library edited is edited for every account at once, and
two copies would compile a song two ways.

- **The folder IS the library**: its published versions `1/`, `2/`… each with a `library.yaml`
  saying what level of st0 it `requires`, and the `draft/` an admin's file service writes. The draft
  is made, from the newest version, only when an admin's service asks (`/libraries/sync` with
  `draft: true`), so a machine with no admin carries no second copy. `publish` freezes the draft as
  the next version. A folder from before versions is moved whole into `1/` on the next `ensure`.
  Dropping a library from the list keeps its folder, unlisted: it is the only copy.
- **A listed library with no folder gets one**, copied from the seed as its version 1 when the
  seed holds it, else an empty version 1. The seed is `$STUDIO_LIBRARY_SEED`: a folder of libraries, or `name=folder,…` — the desktop
  and the phone name the `st0-library` they bundle. It is copied into a dot-named sibling and renamed
  into place, so no reader sees half a library, and without any `.git` it carries.
- **With no list written yet**, the list is the library folders already on disk, else the seed's.
- **The libraries are st0fs workspaces** (`../libraryRelay.ts`). The hub is the server's replica of
  each: it watches the folder and relays every change to the room `<name>` of the account
  `_libraries`, kept beside the folders in `libraries/.sync-relay/`. Only the hub holds that
  account's secret, so no replica can write a library through the relay: a write reaches a library
  only through an admin's file service, on this disk. Their binaries reach the account's blob store
  like any workspace's (`blobs.md`).
- **A paired machine's libraries FOLLOW the origin's, read-only.** As soon as one of its accounts is
  paired (`../syncRemote.ts`), the hub's library replica dials the origin's relay with that
  account's device token and joins each library as `@lib/<name>` (`syncRelay.md`): the room's text
  is written into `libraries/<name>`, binaries come from the origin's store, a file only here goes,
  and a local edit is put back to the room's text and never sent. A library must be written on the
  origin, by an admin: a write anywhere else would be a fork nobody else sees.
- **The machine follows the names on ITS list**, which the seed provides (`st0`): the origin's relay
  does not list library rooms, so a library the origin adds reaches a machine only once that
  machine lists it. The first paired account found is the one whose token is used: every pairing
  names the same origin.
- **Pairing is noticed by polling**, every 30 s: pairing restarts only the account's own service,
  and the libraries are the hub's. An unpaired hub — the origin, a desktop never paired — relays
  its folders to its own relay as above, with a head of its own (`.sync-replica/`, beside
  `.sync-follow/` for the origin's), since the two relays' seqs are different numbers.

`/account/libraries` is answered by the hub and never forwarded (`../librariesRoutes.ts`): `GET` the
list, for anyone, giving every listed library its folder first; `PUT` the list (`{ libraries:
[{ name }] }`), for admins, 403 otherwise.

The file services call back on `/api/files-hub/internal` (`$STUDIO_HUB_URL`), which serves one
route, `POST /libraries/sync`: the folders made sure of before an open. Its gate is the hub secret
of one of the hub's own instances — the secret that already proves the other direction.

## An engine is bound by a CLAIM

A request naming an engine (`x-studio-engine-id`) binds the account's file service to it only
when that account **holds a claim** on it in the registry. The registry lists every engine to
everyone, and a header is not permission; the claim is (`packages/engine-registry/docs/claim.md`).
A binding that fails leaves the files reachable and says why in the log.

A bound engine sees exactly five roots of the account: its `workspace/` folder, writable, so a take
comes back; its render cache `.renders/`, writable, so an automatic VST render comes back
(`packages/song/docs/autoFreeze.md`); its undo cache `.history/`, writable, since the machine KEEPS
an undo's audio and sends it back up for an undo (`packages/file-service/docs/history.md`); its
`models/`, read-only; and the médiathèque, read-only.
**Never the rest of `$STUDIO_HOME`**, which holds the
account's own state: an engine's machine may be a shared studio box.

A binding is two loopback paths to the same machine: the engine's, and its **jobs** — where every
separation the account asks for runs, since cutting stems belongs to the engine's machine
(`packages/stem-separation/docs/stemSplit.md`). The account's `models/` is shared too, read-only,
so a model downloaded once here reaches that machine once.

The engine's plugin list is fetched over the tunnel at binding time and written as
`<home>/exts.json`, the scan file's own shape, so everything that reads the engine's catalogue
works unchanged. A rescan on the engine's machine reaches the server at the next binding.

## An engine serves one account at a time

An engine is shared, never concurrently: the account holding its claim drives it. When the claim
moves on, the previous account's file service **lets go** of the engine at its next request, before
anything else, so a tab left open cannot push its project into an engine someone else is playing.
Each account's copy on the engine's machine stays in its own folder, `ws-<accountKey>`, and is
simply there again when that account comes back. The libraries travel beside it, read-only, as
one root (`../binding.ts`), `libs`: the hub's folders, the same for every account. A module's files the engine loads — a Faust source, an amp's model, its
samples — live in one, and no workspace holds a copy (`packages/file-service/docs/libraries.md`).

## What stays on the engine's machine

What drives or needs the machine's own hardware, for every account alike: its audio devices, its
plugins, the separations its CPU runs, and playing a song on its speakers. No file service runs
there: the server asks for that work as jobs over the tunnel (`packages/engine-tunnel/docs/jobs.md`).
