# Where a machine's state lives

One directory holds everything st0 keeps on a musician's machine: the engine's identity, the
supervisor's settings, the plugin scan cache, the media library, the SSH keys, the merged log
and the **workspaces**. `packages/engine-client/src/paths.ts` is the single definition of what
is in it; `packages/song/src/studioHome.ts` is where it is.

Throughout the docs it is written `<state>`.

`~/.st0`, on **all three platforms**.

`$STUDIO_HOME` overrides it, and that is not a debug hatch: it is how every test that touches this
gets a directory of its own.

## One path, because THREE languages compute it

The per-platform location each OS prefers would be the tidier answer if one program owned this
directory. Four do, in three languages: `packages/song/src/studioHome.ts`,
`scripts/stateDir.mjs` for the plain-node scripts, `engine/st0-tray/src-tauri/src/paths.rs`, and
`engine/st0-engine/engine/PluginScan.cpp`.

Each language's idea of "where application data goes" is subtly its own, and they do not line up:
JUCE's `userApplicationDataDirectory` is `~/Library` on macOS where node's equivalent is
`~/Library/Application Support`. Two of the four disagreeing is not a build error — it is an
engine writing its plugin cache where nothing reads it, which surfaces as a médiathèque that is
simply empty. A home dotfile is one rule, mirrorable in three languages by inspection.

## `workspace/`, with nobody underneath it

The path is `workspace/<workspace>`, with no per-person level. **One machine holds one person's
workspaces** — a musician's laptop is never a multi-user file service — and a level named after the
account would cost more than it buys:

- **It would have to be renamed when the identity changes**, which pairing a server forces: it turns
  a local identity into an account email, and every offline project under the old name would stop
  being listed with no error anywhere to say so.
- **The owner is told, never read out of a path.** The file service builds the engine session id
  from `noteOwner`, fed by the header every request carries, and both halves go through
  `sessionFor` (`packages/engine-protocol/docs/sessions.md`), so they cannot spell it differently.

`slugify` still has two users, neither of them a directory here: the SSH key folder
(`<state>/ssh/<slug>`) and the engine session.

## Every path through `paths.ts`

**Use the functions in `paths.ts`, never a hand-joined path.** A wrong path does not throw — it
reads as an empty file — so a second spelling diverges in silence. That is why `studioHome`
lives in `@studio/song` (a leaf, node builtins only) rather than being re-derived per package,
and why a test points `$STUDIO_HOME` somewhere rather than faking `HOME`: a faked home directory
misses `%APPDATA%` and `$XDG_CONFIG_HOME` entirely.

## The settings file has one name

`<state>/engine-host.json`, pairing with `engine-host.pid`, written by the supervisor
(`engine/st0-supervisor/src/Settings.h`). `existingSettingsPath` reads that name and no other: a
second name carried for ever costs a branch in every reader plus a test that has to keep asserting
it. A settings file under any other name is not read, so the machine starts from defaults — ports
8765/8770, an empty audio priority, no paired server. That is a deliberate trade: the file is small,
hand-editable, and every value is re-enterable from the settings screen.
