# The file hub — workspaces on the server

A workspace belongs to its account, not to whichever engine happens to be running. So the
server keeps it: `$STUDIO_FILES_ROOT/<account>/workspace/…`, served at `/api/files` by k7's backend
(`apps/k7/backend/src/media/fileHub.ts`), and
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
The price is a Node process per **active** account; an instance nobody called for 10 minutes is
stopped and starts again, in well under a second, on the next request. Ten and not more because a
slot held by an account that left is memory the next account cannot have, while a restart costs
the account that comes back one second.

**Where no process may be started — the iOS app — each runs on a worker thread instead**
(`workerChild.ts`, selected by `STUDIO_FILE_SERVICE_THREADS=1`). A worker has module globals of its
own, which is the isolation the process was for, and its stdin end is still its stop, so the file
service is the same program either way. It runs the bundled entry, `STUDIO_FILE_SERVICE_ENTRY`,
since a thread runs plain JS and not tsx (`engine/k7-runtime/docs/ios.md`).

### It inherits an allow-list, not the backend's environment

A file service runs one account's code paths, and among them a module's jsdsp source
(`packages/song/docs/jsdspJail.md`). The backend's environment holds the origin's secrets — the
session and token signing keys, the OIDC client secret, the render key — and a file service needs
none of them. So `serviceEnv.ts` passes only what the service and the programs it runs read, by name,
and the hub adds each account's own values on top. The hazard runs one way: a variable the file service
starts reading and nobody adds to the list is silently unset there, so the list is a sweep of
every `process.env` read in the service bundle's inputs, plus what the engine it runs reads.

### Bounded, and held off when it crashes

A Node process per account is the one cost of this design that grows with the user count, so it is
**capped**, and the cap comes from the memory the container may use (`../capacity.ts`). The
backend, every file service and their ffmpeg and chromium share one cgroup limit, and an OOM kill
in it takes the whole backend down, every account with it. So the cap is
`(limit − 1.5 GB reserve) / 384 MB`, between 1 and 50, with the limit read from cgroup v2's
`memory.max` or v1's `memory.limit_in_bytes`. The 384 MB is what a service is counted at, not its
heap ceiling: an editing session's resident set with room to grow, or the ceiling plus Node's own
overhead when that is lower. Counting each at its 1 GB ceiling would turn most of the box away to
pay for a runaway that is rare. The reserve is what pays for one: the backend, its children, and
one account that grew. Where no limit is known — a desktop, a phone, a host without a cgroup
limit — the cap is 50, far above the accounts one origin has active at once.
`STUDIO_MAX_FILE_SERVICES` overrides the derivation; the compose file sets it to the value its
default `mem_limit` gives, so the number a deployment runs at is written where it is deployed.
The cap is read from the cgroup files rather than `process.constrainedMemory()` because what that
answers when there is no limit has changed across Node versions, and the files can be tested.

At the cap, a new account's start stops
the least recently used instance that has been idle for two minutes; one with a request still in
flight (a forwarded request is counted until its answer closes, a long download included) or one
kept for a remote pairing is never chosen. When nothing can go, the request answers **503 with
`Retry-After`**, saying the server is busy, instead of forking past the cap. The idle reaper spares an instance in flight too.

`STUDIO_FILE_SERVICE_HEAP_MB` gives each service a heap ceiling (`--max-old-space-size`), so one
account's runaway ends that account's process, which the backoff below then holds off, rather than
the container.

A service that dies on its own is not started again on the very next request: the account waits
1 s, then 2, 4… up to 60 s, answered 503 with `Retry-After` meanwhile, and a service that ran a
healthy minute starts that count over. A crash loop would otherwise fork a process per request.
A stop the hub makes itself — idle, eviction, restart, source change — is no crash.

A stop is **asked, then forced**: the hub closes the child's stdin — its stop on every platform,
since Windows delivers no SIGTERM and a `kill` there ends a process on the spot
(`packages/file-service/docs/shutdown.md`) — sends SIGTERM where there is one, and kills it only
after `STOP_GRACE_MS`, longer than the service's own grace for its requests in flight. `stopAll`
asks every child at once and resolves when each is gone, inside the 8 s k7's backend gives its
own stop.

**A service's children die with it.** On POSIX each file service is started as the leader of its own
process group, and when it exits — stopped, killed past its grace, killed by its heap ceiling, or
crashed — the hub SIGKILLs the group. Without that, the ffmpeg, the render or the stem cut a service
had started outlives it, re-parented to PID 1: still burning CPU, and a zombie once it ends unless
PID 1 reaps (the image runs `tini` for that, `docs/images.md` at the repo root). The group and not a
list of children kept by the service, because a SIGKILLed service runs no code to kill its list, and
a group catches every spawn, the synchronous ones and those a library makes, without any of them
registering. Playwright's chromium is the exception: Playwright starts it in a group of its own,
and kills it on the service's ordinary exit only. On Windows there is no process group to signal, and
`detached` there would open a console window, so a service's children there may outlive it. A worker thread has no
children of its own to kill.

Whatever is left when the hub's process exits is signalled by **one** exit hook, whatever their number: a listener per child
trips Node's MaxListeners warning past ten accounts.

`/api/ready` reads `status()`: how many services run, how many are starting, the cap, the last start
that failed. A start waiting longer than the hub's own timeouts allow is a hub that is wedged.

A child is ready when it answers a **gated** probe carrying its own secret. Its port is picked free
by the hub and released before the child binds it, so another account's child starting at the same
moment may hold it; that one answers 401 to a secret not its own, and the start fails rather than
forwarding one account's requests to another's process. The accounts paired with a remote server —
a tray's or a phone's main one, or a server's secondary — start with the hub and are never reaped:
they are replicas that must keep syncing.

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
`k7-backend`'s dev script and never by the image) the hub watches `@studio/file-service` and every `@studio/*`
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

**Whether the caller is an admin rides the same way.** The host passes `isAdmin(req)`. k7's backend checks
the session's OIDC `groups` against `AUTH_ADMIN_GROUPS`, and an empty list admits nobody. The hello
answers `admin`, the ticket signs it, and the hub stamps `x-studio-admin: 1` on what it forwards,
having dropped any copy the client sent. The file service trusts that header for the same reason
it trusts `x-studio-user`: only the hub's secret reaches it. It guards what reaches every account
at once: the libraries list (answered by the hub itself — below), and in the file service every
write into a library (`packages/file-service/docs/libraries.md`), which follows the stamp request by
request, so a new session's ticket makes an account an admin with no restart. A ticket outlives a group change by up to twelve
hours, the same as it outlives the session.

## The libraries are the hub's

The origin has ONE list of libraries, `<dataRoot>/libraries.json` (`../libraries.ts`), and ONE
folder per library, `<dataRoot>/libraries/<name>`, which every account's file service gets as
`$STUDIO_LIBRARIES_HOME`. One list because a library is the reference every song resolves
`@<name>/…` against; one folder because a library edited is edited for every account at once, and
two copies would compile a song two ways.

- **The folder IS the library**: its published versions `1/`, `2/`… each with a `library.k7x`
  saying what level of k7 it `requires`, and the `draft/` an admin's file service writes. The draft
  is made, from the newest version, only when an admin asks — their service (`/libraries/sync` with
  `draft: true`) or their Libraries page — so a machine with no admin carries no second copy. `publish` freezes the draft as
  the next version. A folder from before versions is moved whole into `1/` on the next `ensure`.
  A list from before k7 names its default library `st0`: at start the hub renames it `k7-core`
  (`renameLegacyDefault`) — the list's entry, the folder, and the relay's and replicas' state under
  `.sync-*`, so a device following it keeps its history. Once, and never over a `k7-core` already there.
  Dropping a library from the list keeps its folder, unlisted: it is the only copy.
- **A version's legacy `library.yaml` is upgraded once**, in the folders the hub owns, to
  `library.k7x` (`packages/file-service/src/legacyUpgrade.ts`), the `.yaml` removed once the copy reads back
  as the same manifest. A seed is read where it is, in either format: it is not the hub's to write.
- **A listed library with no folder gets one**, copied from the seed when the seed holds it, else
  an empty version 1. A seed carrying a `library.k7x` is a PUBLISHED version — the repo's `k7-core`,
  what the desktop and the phone bundle — and installs under its own number; a bare folder is
  version 1. A machine that already has the library and is handed a seed declaring a version it does
  not hold (an app update, a dev server after the repo's `k7-core` moved) gets it as one more frozen
  version. **A seed never overwrites a version.** Its number taken by ANOTHER version — an admin
  published their own from the draft — it goes in as the next free number, its manifest saying
  `seed: <its own>`: both series are kept, a pin on the taken number keeps hearing what it heard, and
  the next start finds the seed under its new number rather than adding it again. Same number, same
  `requires`, same notes is the seed itself, which is why a seed's notes say what it changed. The seed is `$STUDIO_LIBRARY_SEED`: a folder of libraries, or `name=folder,…` — the tray
  and the phone name the `k7-core` they bundle. It is copied into a dot-named sibling and renamed
  into place, so no reader sees half a library, and without any `.git` it carries.
- **Every copy is asynchronous, and they run one at a time.** A library is IR and amp-model
  binaries, and the hub lives in the one process every account is served by: a synchronous copy of
  one on a publish or a seed stops every request until it ends. Asynchronous, two copies could
  decide on the same name at once — two seeds of one library, two publishes numbering the same
  version — so `set`, `ensure` and `publish` queue behind each other inside the store. At start
  the relay follows the libraries only once their folders are there.
- **The first `ensure` is one shared promise, `firstEnsure`.** The relay waits on it, and so does a
  standalone backend before it listens (`apps/k7/backend/docs/standalone.md`, "Ready means the
  library is there"). A file service asked for a workspace with no library on disk asks the hub
  for an `ensure` before it refuses: queued behind a copy still running, it answers once the copy
  has ended, so it is refused only when there is truly no library, or when the copy failed — and
  then it names the failure.
- **The hub's own routes read their body themselves**, since k7's backend parses nothing under the
  hub's paths (`apps/k7/backend/docs/hardening.md`): `jsonBody` reads it, refusing past 8 MB — the
  file service's own limit — with a 413.
- **With no list written yet**, the list is the library folders already on disk, else the seed's.
- **The libraries are k7fs workspaces** (`../libraryRelay.ts`). The hub is the server's replica of
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
- **A followed library's folder is the follow's, and the hub writes nothing in it** (`followed`,
  true while an account is paired and until the relay has let the follow go). No seed version, no
  draft, no publish, no version fetched from the public listing: the versions a paired machine holds
  are the origin's, so a workspace synced from the origin pins a number that means the same files on
  both sides. The hazard this answers: a seed copied into a followed folder is undone file by file
  by the follow, and a hub that then no longer recognises it adds it again on every `ensure` — which
  every library list runs — one more version folder each time. A newer bundled seed therefore
  reaches a paired machine only once the origin publishes it.
- **A version folder holding no file but dot-files is a HUSK, not a version, and `ensure` removes
  it** (`../libraryDirs.ts`). It is what a follow leaves of a version only this machine had: its
  files undone, its folders and the `.gitkeep`s no capture sees kept. Removing one loses nothing,
  since a published version always holds its manifest; a version holding any file, manifest or
  not, is never touched, and on a followed machine neither is one the room knows (its
  `.sync-follow/<name>/confirmed/<n>`), which may be a folder the follow is still filling. Left in
  place, a husk would be the newest version, and a workspace pinning it would resolve nothing.
- **The machine follows the names on ITS list**, which the seed provides (`k7`): the origin's relay
  does not list library rooms, so a library the origin adds reaches a machine only once that
  machine lists it. The first paired account found is the one whose token is used: every pairing
  names the same origin.
- **Only a tray or a phone follows a MAIN server.** `remotePairing`, which k7's backend sets from
  `STUDIO_LOCAL_USER=1` — the standalone bundle's mark (`apps/k7/backend/standalone.json`) — is what
  lets a pairing be the main one, and only then do the libraries follow it. Since they follow the
  FIRST paired account found, a main pairing on a server would let any signed-in user point every
  account's libraries at a server of their choosing. A server's accounts pair SECONDARIES only
  (`syncRelay.md`, "A server's accounts"): `POST /api/sync/remote/main` answers 403, every pairing is
  stored and served as a secondary, the account's service keeps the server's own relay as its main
  one, and the libraries always relay locally.
- **Pairing is noticed by polling**, every 30 s: pairing restarts only the account's own service,
  and the libraries are the hub's. An unpaired hub — the origin, a desktop never paired — relays
  its folders to its own relay as above, with a head of its own (`.sync-replica/`, beside
  `.sync-follow/` for the origin's), since the two relays' seqs are different numbers.

`/account/libraries` is answered by the hub and never forwarded (`../librariesRoutes.ts`): `GET` the
list, for anyone, giving every listed library its folder first — and for an admin its draft too, so
the Libraries page offers a publish before that admin's file service ever ran — each with its
published versions and whether it has a draft; `PUT` the list (`{ libraries: [{ name }] }`), for admins, 403
otherwise; `POST /account/libraries/<name>/publish` (`{ requires?, notes? }`), for admins, freezes
the draft as the next version.

The file services call back on `/api/files-hub/internal` (`$STUDIO_HUB_URL`), which serves two
routes: `POST /libraries/sync`, the folders made sure of before an open — and, given a `version`,
that version brought down from the origin (`../libraryFetch.ts`); and `POST /libraries/remote`, the
versions the origin publishes, which only a hub naming `$STUDIO_LIBRARY_ORIGIN` asks for.

`/api/public/libraries` (`../publicLibraries.ts`) is the origin's side of that: the published
versions of `k7`, their files and digests, with no session, never the draft. Its gate is the hub secret
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
works unchanged. When the engine answers that its scan is still running — it scans at every
start — the hub keeps the channel open, for fifteen minutes at most, and writes the list again
from the one the scan ends on (`engine/k7-runtime/docs/plugins.md`). A rescan asked later reaches
the server at the next binding, or through the account's file service when a project waits for it
(`packages/file-service/docs/engineLoad.md`). Both writers go through one function and leave a
copy that already says the same untouched, since its mtime is in every project's revision token.

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
