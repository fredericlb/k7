# Where a machine's state lives

One directory holds everything st0 keeps on a musician's machine: the engine's identity, the
supervisor's settings, the plugin scan cache, the media library, the SSH keys, the merged log
and the **workspaces**. `packages/engine-client/src/paths.ts` is the single definition of what
is in it; `packages/song/src/studioHome.ts` is where it is.

Throughout the docs it is written `<state>`.

| platform | `<state>` |
|---|---|
| macOS | `~/Library/Application Support/st0` |
| Windows | `%APPDATA%\st0` |
| Linux | `$XDG_CONFIG_HOME/st0`, else `~/.config/st0` |

`$STUDIO_HOME` overrides all three, and that is not a debug hatch: it is how a process on one
side of a WSL boundary shares the directory that lives on the other (`docs/wsl.md`), and how
every test that touches this gets a directory of its own.

## It was `<state>`, and nothing was migrated

A dotfile in the home directory is not where a desktop app's data belongs on any of the three
platforms. The move was made **without a migration**, deliberately: the old `<state>` is left
exactly where it is, and a machine that had one starts the new one empty. Repositories are
re-cloned from the home page, which is a minute's work and cannot half-succeed — where moving a
tree of git checkouts between directories can.

If you are looking for songs that "disappeared", they are in `<state>/workspace/`.

## `workspace/`, with nobody underneath it

It was `root/<slug>/<workspace>`, the slug being the account's email with every
non-alphanumeric character replaced by `_`. It is now `workspace/<workspace>`.

**One machine holds one person's workspaces.** That was always true in practice — the slug
level existed for a multi-user file service that a musician's laptop never is — and it cost
more than it bought:

- `apps/st0-desktop/src/server/identity.ts` existed to RENAME that directory when the
  identity changed, because pairing a server turns a local identity into an account email, the
  slug changes with it, and every offline project stops being listed with no error anywhere to
  say so. There is nothing to rename now, and that whole hazard is gone.
- The file service read the owner out of the PATH to build the engine session id. It is now
  told instead — `noteOwner`, from the header every request carries — and
  `packages/engine-protocol/docs/sessions.md`'s rule is unchanged: both halves go through
  `sessionFor`, so they cannot spell it differently.

`slugify` survives, because two things still need that spelling and neither is a directory
here: the SSH key folder (`<state>/ssh/<slug>`) and the engine session.

## The rule that has not changed

**Use the functions in `paths.ts`, never a hand-joined path.** A wrong path does not throw — it
reads as an empty file — so a second spelling diverges in silence. That is why `studioHome`
lives in `@studio/song` (a leaf, node builtins only) rather than being re-derived per package,
and why a test points `$STUDIO_HOME` somewhere rather than faking `HOME`: faking the home
directory used to work and now misses `%APPDATA%` and `$XDG_CONFIG_HOME` entirely.

## The settings file has had two names, and reads only one

`<state>/engine-host.json`, pairing with `engine-host.pid`. It was `engine-tray.json` while the app
was a tray, and `existingSettingsPath` read whichever a machine had — the migration in ONE place,
because a reader that forgot it would answer defaults and lose an audio pick with nothing to say so.

**That fallback is gone.** The tray it was named after no longer exists, and carrying a second name
for ever costs a branch in every reader plus a test that has to keep asserting it. A machine that
still holds only `engine-tray.json` therefore starts from defaults: the ports go back to 8765/8770,
the audio priority empties, and a paired server has to be paired again.

That is the whole of the migration, and it is a deliberate loss rather than an oversight — the
file is small, hand-editable, and its values are all re-enterable from the settings screen. Anyone
who wants the old one back renames it by hand, which is the same act the code used to do for them.
