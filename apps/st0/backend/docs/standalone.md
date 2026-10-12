# st0's backend on the user's own machine

Two apps run this backend on the user's device rather than on a server: the desktop app
(`apps/st0-standalone/docs/standalone.md`) and the phone (`engine/st0-engine/docs/android.md`). Both
run the **same bundle** and start it from the **same table**, so the two cannot drift apart.

## The table: `standalone.json`

The port, the environment and the state folders, read by `apps/st0-standalone/src/main.ts` and by
`BackendHost.kt` (the phone's, through a `BuildConfig` constant for the port and the copy inside its
`backend.zip` for the rest). What each host adds is only what is its own: the state root, the
session secret it keeps there, `$STUDIO_ENGINE` where an engine binary exists, and the file
service's entry.

| value | why |
|---|---|
| `port` 18789 | not a dev session's 8789, so the desktop app runs beside `npm run dev`; FIXED, because a page's storage is keyed on its origin, port included, and because the OIDC client's redirect is registered on it |
| `OIDC_*`: st0's provider, the public client `st0-desktop`, no secret | an app on the user's device cannot keep a secret, so PKCE alone proves the callback (`apps/st0-standalone/docs/signIn.md`); `groups`, so an account's admin rights come with it |
| `STUDIO_LOCAL_USER=1` | signed out is a local user, never a dead end: nothing needs a network to start |
| `COOKIE_DOMAIN` empty | a domain would make the session cookie `Secure`, and the origin is plain http on loopback |
| `dirs` | the folders under the host's state root, named once so a backup or a support answer reads the same on both |
| `library` | the one-commit clone the bundle carries, which a first run seeds the library list with: the local user is never an admin and could not add one |

The desktop still lets `ST0_OIDC_ISSUER` and `ST0_OIDC_CLIENT_ID` override the provider, for testing
against another one.

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
