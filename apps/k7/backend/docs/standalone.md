# k7's backend on the user's own machine

Two apps run this backend on the user's device rather than on a server: the desktop app
(`apps/k7-standalone/docs/standalone.md`) and the phone (`engine/k7-runtime/docs/android.md`). Both
run the **same bundle** and start it from the **same table**, so the two cannot drift apart.

## The table: `standalone.json`

The port, the environment and the state folders, read by `apps/k7-standalone/src/main.ts` and by
`BackendHost.kt` (the phone's, through a `BuildConfig` constant for the port and the copy inside its
`backend.zip` for the rest). What each host adds is only what is its own: the state root, the
session secret it keeps there, `$STUDIO_ENGINE` where an engine binary exists, and the file
service's entry.

| value | why |
|---|---|
| `port` 18789 | not a dev session's 8789, so the desktop app runs beside `npm run dev`; FIXED, because a page's storage is keyed on its origin, port included, and because the OIDC client's redirect is registered on it |
| `OIDC_*`: k7's provider, the public client `st0-desktop` (the provider's name for it), no secret | an app on the user's device cannot keep a secret, so PKCE alone proves the callback (`apps/k7-standalone/docs/signIn.md`); `groups`, so an account's admin rights come with it |
| `STUDIO_LOCAL_USER=1` | signed out is a local user, never a dead end: nothing needs a network to start |
| `STUDIO_LISTEN_HOST` `127.0.0.1` | the backend answers its own machine only — below |
| `K7_INSTANCE=local` | releases and pages live on the server alone: this backend forwards them to the paired server, and has none without it (`packages/rehearsal-server/docs/publications.md`) |
| `STUDIO_LIBRARY_ORIGIN` `https://st0.app` | where a machine never paired finds newer versions of the `k7-core` library and fetches them (`packages/file-hub/libraryFetch.ts`); a hosted origin never sets it, since it IS one, and asking another would mix two origins' libraries |
| `COOKIE_DOMAIN` empty | a domain would make the session cookie `Secure`, and the origin is plain http on loopback |
| `STUDIO_MP3_SWEEP=0` | no background MP3 beside every FLAC: the window plays a FLAC as it is, the engine shares the CPU, and the phone has no ffmpeg (`media/derivedMp3.md`) |
| `dirs` | the folders under the host's state root, named once so a backup or a support answer reads the same on both; `K7_DATA_DIR` holds the rehearsal recorder's store, as on the server (`packages/rehearsal-server/docs/store.md`) |
| `library` | the `k7-core` folder the bundle carries, handed to the hub as its seed (`STUDIO_LIBRARY_SEED`): the local user is never an admin and could not add one. `bundle.mjs` fills it with the newest version the origin published that this build runs, so a new install starts on a real version number (`../scripts/libraryArchive.mjs`) |

The desktop still lets `K7_OIDC_ISSUER` and `K7_OIDC_CLIENT_ID` override the provider, for testing
against another one.

## It answers its own machine only

`/auth/local` hands a session to whoever asks, so this backend must be unreachable by anyone but the
person at the machine — a venue's Wi-Fi is full of strangers. Three locks, each for a different way in:

| lock | what it stops |
|---|---|
| `STUDIO_LISTEN_HOST=127.0.0.1` — `server.ts` binds there instead of every interface | a device on the same network opening `http://<ip>:18789/auth/local` |
| `loopbackOnly` (`src/loopback.ts`) on every route while `STUDIO_LOCAL_USER=1`: the peer address AND the `Host` header must be loopback | DNS rebinding: a page whose name resolves to `127.0.0.1` reaches the port from the user's own browser, and only its `Host` gives it away |
| `/auth/local` checks both again (`src/handoff.ts`) | the same, should a host ever start the local user without the other two |

Nothing on another device needs this backend. A device on the network drives the **engine**, on
the engine's own port and once paired (`engine/k7-runtime/docs/pairing.md`). The QR codes the window
draws rebase onto `lanUrls`, which the desktop app does not supply, so they show no code rather than
a link into this port (`apps/k7/frontend/docs/shell.md`); serving k7's pages to a tablet from here
would mean lifting all three locks, and a login of its own for the tablet. The supervisor, the file
services and the window all reach this backend on `127.0.0.1`. The locks cover HTTP routes; a
WebSocket upgrade is answered by its own listener and is that listener's to check.

## The bundle: `scripts/bundle.mjs`

The backend and the file service it starts, each one ESM file, plus the files they read at run time —
the built frontend, the song's `meta/`, `commands.yaml`, the demos, the video sample — and the
bundled DSP runner, at their REPO paths. A source's `import.meta` is rewritten to its original path
under that tree, so `new URL("../meta", import.meta.url)` finds the same file it finds in a checkout.
A data file a source starts reading is added to `DATA`; `--list` prints every source the rewrite touched.

| choice | why |
|---|---|
| a bundle, not source under tsx | tsx needs esbuild's native binary, which the phone's node cannot load; and the desktop app shipped 150 MB of source and `node_modules` for an 8 MB bundle |
| `$STUDIO_FILE_SERVICE_ENTRY` | the file hub starts each account's file service with tsx over its source otherwise, and a bundle ships neither |
| `cpu-features` and `*.node` left out | ssh2's native helpers, optional: it falls back to JS, and no addon could target both Electron's node and Termux's |
| `node24` | the oldest node it runs under — Electron's |

An unpackaged desktop run stays on the checkout's source under tsx, so an edit needs no bundling.
