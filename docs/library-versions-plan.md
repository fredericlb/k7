# Library versions: upgrade a library without reinstalling st0

The decisions of the library-versions work, in one place. What is built is described by
`../packages/song/docs/sharedFolders.md` and `../packages/file-hub/docs/fileHub.md`; this page
says the whole design and which lots remain.

## The goal

- A new install has the default `st0` library, with no network.
- A user upgrades a library without installing st0 again.
- A library may need a newer st0 than the one running; that upgrade is then refused, with the reason.
- Nobody but an admin edits a library. A user who wants a module different FORKS it into their own
  account library.
- The server opens every song: one pinned to the latest library, one pinned to an old one, one whose
  modules come from its account's library.

## What forces versions

The origin holds one folder per library and a song hears it as an admin last left it. That cannot
meet the last goal: a desktop whose st0 is too old for the newest library keeps playing an older
one, and the server must open that song as the desktop hears it. So **a library is a series of
published versions, frozen, and every workspace names the version it uses.**

The cost is accepted on purpose: a library fix reaches a workspace only when that workspace
upgrades. That is the price of a song sounding the same on every replica.

## A version is frozen

- An admin edits `libraries/<name>/draft/`, live, exactly as a library is edited today.
- **Publish** freezes the draft as `libraries/<name>/<n>/`, `n` an integer counting up from 1.
  A published version never changes; a fix is a new version.
- Every library of the origin is versioned, `st0` and any other alike: one mechanism, no exception.
- The origin keeps every version a workspace of any account pins. Binaries are in the blob store,
  so an old version costs its text and nothing else.
- Each version carries `library.yaml`: `name`, `version`, `requires`, and the publish notes.

## `requires` is a LEVEL, not an app version

st0 has several version schemes: the image stamp (`26.08031412`), the desktop's snapshot and
`vX.Y.Z` tags, the phone's build. None compares with the others. So st0 declares one integer,
`LIBRARY_LEVEL`, and a library declares `requires: <level>`.

- The level rises when the compiler or the engine gains something a library can use: a module type,
  a parameter kind, a bundled plugin, a field of `module.yaml`.
- **An st0 at level N runs every library whose `requires` is at most N.** That is the compatibility
  promise, and what lets the server open an old pin: the server is always at the highest level.
- Publish refuses a draft whose `requires` exceeds the origin's own level. Unsaid, `requires` is
  the previous version's, so a publish never raises the floor by accident.
- On a desktop or a phone the backend and the engine ship together, so they share one level. On the
  server, the supervisor states its machine's level in every heartbeat (`kLibraryLevel`, which
  `../packages/song-schema/src/libraryLevel.test.ts` keeps equal to `LIBRARY_LEVEL`); one older than
  the field states none and runs level 1. The editor then warns, above the file tree, for each
  library whose pinned version `requires` more than the engine playing it. A warning and not a
  refusal: what that version adds is unknown to the old engine, and the rest of the song still plays.

## A workspace pins its versions

`_library-pins.yaml` at the workspace root, beside `_modules/` and `_playlists/`:

```yaml
st0: 7
drums: 2
```

- It is a workspace file, so it reaches every replica by live sync, and the server, the desktop and
  the phone resolve the same song against the same version.
- Per workspace, not per song: every project of a workspace shares one catalogue, as they share
  `_modules`.
- A library the file does not name resolves to the version that was current when versions arrived,
  and the first open WRITES that pin, so no song changes sound unasked.
- A new workspace pins the newest version its st0 can run.
- An admin's workspace pins `draft`, new or not: an admin authors the library from their own
  workspaces, and a frozen version refuses the write.

## Upgrade

- **The source is the server.** `/api/public/libraries` lists the versions of `st0` with `requires`
  and notes, each version's files with their digests, and each file. It is readable without signing
  in, so an unpaired desktop can upgrade too; only `st0`, the library every install starts from,
  since any other reaches a machine through a paired account. A version comes down FILE by file
  rather than as one archive: most files do not change between two versions, and one whose digest
  the machine already holds is copied instead of downloaded. A frozen version caches forever.
- **Only a machine that names an origin asks one** (`STUDIO_LIBRARY_ORIGIN`, set by the desktop and
  phone table). A hosted origin never does: it IS one, and the private instance asking `st0.app`
  would mix two origins' libraries.
- **First run is the installer's copy.** The desktop and the phone bundle the newest published
  version of `st0` the build runs, `library.yaml` included, and install it under that number on first
  run, with no network. A folder rather than an archive: the bundle is files already, and the hub
  copies a folder. An app update carrying a newer version adds it as one more frozen version and
  moves no pin. A build that cannot reach the origin bundles the repo's `st0-library` and says so:
  that one installs as version 1, which is what it is on an origin seeded from it.
- **Upgrade is a per-workspace action**, the verb `library upgrade <library> [version]` and the
  strip above the editor's file tree: it fetches the version if the machine lacks it, then rewrites
  the pin and recompiles the song. It lists the forks whose base changed between the two versions —
  `_modules` today, the account library once it exists — so the user listens to them again.
- **Too old is refused.** A version whose `requires` exceeds the running level is shown disabled with
  "needs st0 level N — update st0", and the newest version the app can run is offered instead.
- A paired machine no longer follows a library live: it fetches the versions its workspaces pin,
  which is also what it needs on its disk before a gig.

## Overrides are forks into the ACCOUNT library

A ref keeps naming exactly one folder: nothing shadows `@st0/x` in place. Overriding is forking, as
`_modules` forks today, into a library the account owns.

- **The account library** is `<account>/library/` on the server, beside `workspace/`, refs
  `@account/…`. It holds the same families as any library (`modules/`, `chains/`, `presets/`).
  `account` joins `RESERVED_LIBRARY_NAMES`.
- It is the account's own, not versioned and not pinned: it is edited live like `_modules`, and
  reaches every replica by live sync, in the account's room `_account` — a name no workspace can
  take, since a workspace name starts with a letter or a digit. It is no origin library: it neither
  counts for "st0 opens no project without a library" nor takes a pin.
- **Fork** (`module fork <ref>`, also on a node's menu) makes `@account/audio/foo` a module that
  `extends: "@st0/audio/foo"`, carrying the base's panel, then repoints the open project's refs.
  Nothing else is copied: the fork keeps inheriting whatever it does not change. Forking again
  keeps what the fork already holds.
- What it extends resolves against the pin of the workspace that opens it, so one fork may sit on
  `st0` 7 in one workspace and 9 in another. That is why upgrade lists the forks whose base moved.
- Resolution order: the project, `@workspace`, `@account`, the pinned libraries. Each still keys
  under its own name, so the order decides lookup and never which module a ref means.

## How the server opens any song

It reads the workspace's `_library-pins.yaml`, resolves `@<name>/…` in `libraries/<name>/<pin>/`,
and `@account/…` in the account's own folder. The server holds every pinned version, every account
library and every workspace, and runs at the highest level, so latest, old and forked all open.

## Lots

1. **Built.** `library.yaml`, `LIBRARY_LEVEL` (`../packages/song-schema/src/libraryVersions.ts`), the
   `draft/` + `<n>/` layout on the origin, an existing library moved into `1/`, the draft made on an
   admin's ask, and `LibraryStore.publish` (`../packages/file-hub/libraries.ts`).
2. **Built.** `_library-pins.yaml`: the compile, the file tree and the presets read the pinned
   folder, and `ensureLibraryPins` (`../packages/file-service/src/libraryPins.ts`) writes it on
   workspace creation and on the first open.
3. **Built:** Publish on the Libraries page, `POST /account/libraries/<name>/publish`, and each
   library's versions in `GET /account/libraries`.
4. **Built:** `library versions` and `library upgrade` (`../packages/commands/src/verbs/library.ts`),
   the strip above the file tree, the public listing and per-file download
   (`../packages/file-hub/publicLibraries.ts`, `libraryFetch.ts`). **Remains:** a paired machine still
   follows each library whole through the relay, every version and the draft included; fetching
   only what its workspaces pin is a disk saving, not a correctness one.
5. **Built.** `apps/st0/backend/scripts/libraryArchive.mjs` bundles the published version; the hub
   seeds a published seed under its number and adds a newer one on an app update.
6. **Built.** `@account` (`accountLibraryHome` in `../packages/song/src/sharedFolders.ts`), its room
   (`attachAccountLibrary`, `../packages/file-service/src/workspaces.ts`), `module fork`
   (`../packages/song/src/accountFork.ts`), its presets scope, and upgrade's list of the forks whose
   base moved.
7. **Built.** The supervisor's heartbeat carries `libraryLevel`, the registry hands it to the
   browser, and `LibraryUpgrades.tsx` warns.
