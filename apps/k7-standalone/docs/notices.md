# What the app tells the person

Three things happen out of sight of the page in front: a newer k7 is published, the engine or its
supervisor goes away, and a sign-in or a pairing waits on the system browser. Each is said where the
person will see it.

## A newer k7

The app **updates itself where it can**, from `https://k7.rocks/app_downloads`, through
`@studio/app-updates` — the same updater the tray runs, on the desktop app's own feed. When it
asks, what it downloads, what it says and how to turn it off are that package's
(`packages/app-updates/docs/appUpdates.md`); `src/updates.ts` only wires it in. What is the desktop
app's own:

- **Check for updates is also on k7's home page**, in the account menu beside Settings, since the
  window has no menu bar on Windows and Linux. The page sends `studio:updates:check`, which the main
  process takes from k7's own origin only, and runs the menu's check.
- **The menu's checkbox** (`docs/menu.md`) is what turns the automatic check off.

## The engine and its supervisor

The pages already hear the supervisor's state over `studio:engine` (`docs/engine.md`), and draw it.
`src/notices.ts` adds an **OS notification** for the person who is looking at another window:

| event | said |
|---|---|
| the engine reports an error | that it stopped, with the supervisor's reason |
| the engine runs again after an error | that it is back |
| the supervisor exits and is relaunched | that it stopped, and why |
| the supervisor sends a `notify` frame | as it is; a `modal` one as a dialog that blocks nothing |
| no supervisor in this build | that k7 runs without its engine; the pages hear it as `down` too |

A plain stop says nothing: it may be the person's own Stop or Restart. **Each kind is said once per
five minutes**, so an engine in a crash loop is one notification and not one a second; and nothing
is said once the app is quitting, which stops the engine on purpose.

## A sign-in or a pairing in the browser

Both happen in the system browser (`docs/signIn.md`, `docs/sync.md`), and the app waits meanwhile:
on a loopback port of its own for a sign-in, on the local backend for a pairing. `src/accountStatus.ts` tells k7's pages where that stands, over
`studio:auth:status`, and the home page's account bar draws it beside its button
(`apps/k7/frontend/src/tabs/AccountStatusNote.tsx`): waiting, with **Cancel**, which closes the
port or drops the pairing; then how it ended — signed in, paired, or why not (a typed address that is no server, a
browser trip left unfinished for ten minutes, a browser signed in as another account, a token the
local backend could not keep). The main process sends a code and the page words it, so the text is
in the person's language.

**The second browser trip is announced.** Right after a sign-in, pairing opens the browser again;
unexplained, that reads as the sign-in having failed. So the automatic pairing asks first, in a
native dialog, and Not now leaves the account unpaired until the next start, or Add a server on the
home page.
