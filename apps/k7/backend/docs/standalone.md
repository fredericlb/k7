# k7's backend on the user's own machine

Two apps run this backend on the user's device rather than on a server: the tray on a computer
(`apps/k7-tray/docs/tray.md`) and the phone (`engine/k7-runtime/docs/android.md`). Both
run the **same bundle** and start it from the **same table**, so the two cannot drift apart.

## The table: `standalone.json`

The port, the environment and the state folders, read by the tray (`apps/k7-tray/src-tauri/src/backend.rs`) and by
`BackendHost.kt` (the phone's, through a `BuildConfig` constant for the port and the copy inside its
`backend.zip` for the rest). What each host adds is only what is its own: the state root, the
session secret it keeps there, `$STUDIO_ENGINE` where an engine binary exists, and the file
service's entry.

| value | why |
|---|---|
| `port` 18789 | FIXED, on the computer as on the phone, because a page's storage is keyed on its origin, port included, because the OIDC client's redirect is registered on it, and because a sync pairing's browser comes back to it, perhaps after the app was killed (`packages/file-hub/docs/syncRelay.md`) |
| `OIDC_*`: k7's provider, the public client `st0-desktop` (the provider's name for it), no secret | an app on the user's device cannot keep a secret, so PKCE alone proves the callback (`apps/k7/frontend/docs/localApp.md`); `groups`, so an account's admin rights come with it |
| `STUDIO_LOCAL_USER=1` | signed out is a local user, never a dead end: nothing needs a network to start |
| `STUDIO_LISTEN_HOST` `127.0.0.1` | the backend answers its own machine only — below |
| `K7_INSTANCE=local` | releases and pages live on the server alone: this backend forwards them to the paired server, and has none without it (`packages/rehearsal-server/docs/publications.md`) |
| `STUDIO_LIBRARY_ORIGIN` `https://app.k7.rocks` | where a machine never paired finds newer versions of the `k7-core` library and fetches them (`packages/file-hub/libraryFetch.ts`); a hosted origin never sets it, since it IS one, and asking another would mix two origins' libraries |
| `COOKIE_DOMAIN` empty | a domain would make the session cookie `Secure`, and the origin is plain http on loopback |
| `STUDIO_MP3_SWEEP=0` | no background MP3 beside every FLAC: the page plays a FLAC as it is, the engine shares the CPU, and the phone has no ffmpeg (`media/derivedMp3.md`) |
| `dirs` | the folders under the host's state root, named once so a backup or a support answer reads the same on both; `K7_DATA_DIR` holds the rehearsal recorder's store, as on the server (`packages/rehearsal-server/docs/store.md`) |
| `library` | the `k7-core` folder the bundle carries, handed to the hub as its seed (`STUDIO_LIBRARY_SEED`): the local user is never an admin and could not add one. `bundle.mjs` fills it with the newest version this build runs — the origin's published one, or the repo's `k7-core` when its `library.k7x` declares a higher number — so a new install starts on a real version number (`../scripts/libraryArchive.mjs`) |

## Ready means the library is there

**On a standalone the backend LISTENS only once the hub's first library ensure has settled**
(`src/listenGate.ts`, `LibraryStore.firstEnsure`). Every host calls the backend ready on its first
answer on `/api/registry/hello` — the tray, the phone and the iPhone alike — and shows k7 then. A workspace created before the bundled `k7-core` is
installed has no library to resolve its refs against, and the local user is no admin who could add
one; so the copy is part of the start, and neither a person nor a test reaches "create a workspace"
before it. The hosted server listens at once, as it always has: its libraries are an admin's, and a
container that waits to answer fails its healthcheck.

| case | what happens |
|---|---|
| the copy fails | the backend listens anyway and logs `libraries \| '<name>' could not be installed: <why>`; creating a workspace answers 503 with that reason, not the admin message (`packages/file-service/src/libraries.ts`, `libraryRefusal`). Everything that needs no new workspace still works |
| the copy is still running after 45 s | the backend listens anyway, under the hosts' own 60 s for a first answer, so a slow phone starts late rather than fails; a workspace asked for meanwhile WAITS, since its request queues behind the copy in the hub |

## It answers its own machine only

`/auth/local` hands a session to whoever asks, so this backend must be unreachable by anyone but the
person at the machine — a venue's Wi-Fi is full of strangers. Three locks, each for a different way in:

| lock | what it stops |
|---|---|
| `STUDIO_LISTEN_HOST=127.0.0.1` — `server.ts` binds there instead of every interface | a device on the same network opening `http://<ip>:<port>/auth/local` |
| `loopbackOnly` (`src/loopback.ts`) on every route while `STUDIO_LOCAL_USER=1`: the peer address AND the `Host` header must be loopback | DNS rebinding: a page whose name resolves to `127.0.0.1` reaches the port from the user's own browser, and only its `Host` gives it away |
| `/auth/local` checks both again (`src/handoff.ts`) | the same, should a host ever start the local user without the other two |

One route takes no session: `/desktop/sync-pair`, where the server's pairing page, in its own browser tab, brings a sync pairing's
token back. Its gate is the pairing's state, and the three locks hold for it as for every other.

Nothing on another device needs this backend. A device on the network drives the **engine**, on
the engine's own port and once paired (`engine/k7-runtime/docs/pairing.md`). The QR codes the page
draws rebase onto `lanUrls`, which a machine's own backend leaves empty (`apps/k7/frontend/src/desktop.ts`), so they show no code rather than
a link into this port (`apps/k7/frontend/docs/shell.md`); serving k7's pages to a tablet from here
would mean lifting all three locks, and a login of its own for the tablet. The supervisor, the file
services and the page all reach this backend on `127.0.0.1`. The locks cover HTTP routes; a
WebSocket upgrade is answered by its own listener and is that listener's to check.

## The bundle: `scripts/bundle.mjs`

The backend and the file service it starts, each one ESM file, plus the files they read at run time —
the built frontend, the song's `meta/`, `commands.yaml`, the demos, the video sample — at their
REPO paths. A source's `import.meta` is rewritten to its original path
under that tree, so `new URL("../meta", import.meta.url)` finds the same file it finds in a checkout.
A data file a source starts reading is added to `DATA`; `--list` prints every source the rewrite touched.

| choice | why |
|---|---|
| a bundle, not source under tsx | tsx needs esbuild's native binary, which the phone's node cannot load; and source with its `node_modules` weighs about 150 MB against an 8 MB bundle |
| `$STUDIO_FILE_SERVICE_ENTRY` | the file hub starts each account's file service with tsx over its source otherwise, and a bundle ships neither |
| `cpu-features` and `*.node` left out | ssh2's native helpers, optional: it falls back to JS, and no addon could target both the tray's node and Termux's |
| `playwright-core` left out | only the server's picture render reaches it, through a lazy `import()`, and it does not bundle: its optional `chromium-bidi` imports are not installed. The server image has it in `node_modules`; the tray and the phone render no picture |
| `node24` | the node the tray pins and ships beside it (`apps/k7-tray/scripts/stage.mjs`) |
