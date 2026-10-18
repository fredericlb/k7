# What the app tells the person

Three things happen out of sight of the page in front: a newer k7 is published, the engine or its
supervisor goes away, and a sign-in or a pairing waits on the system browser. Each is said where the
person will see it.

## A newer k7

The app **updates itself where it can**, from `https://k7.rocks/app_downloads`, the page every build
is published on (`docs/app-downloads.md` at the root, which also says what guards it: nothing is
signed, so the upload token is what keeps a bad build off the machines).

`src/updates.ts` asks the channel's `<channel>.json` a little after start, then at most every six
hours (`src/updateCheck.ts`, tested). The channel is the running stamp's (`docs/menu.md`): a tagged
build follows `release` and compares tags by number; a snapshot follows `snapshot` and takes any
other commit as later, since that channel only ever holds `main`'s latest build. A checkout run
(`dev`) asks nothing.

| install | what happens |
|---|---|
| Windows (NSIS), AppImage | electron-updater downloads the build in the background and installs it when k7 quits; a dialog offers Restart now |
| macOS, `.deb` | a dialog says a newer k7 exists; Download opens the page in the system browser |

macOS refuses to let an ad-hoc signed app replace itself, and a `.deb` belongs to apt, so neither is
downloaded for the person.

- **Silent when it cannot ask.** Offline or k7.rocks down: nothing is said and the next check
  retries. Only Check for Updates… in the menu says "could not reach". A failed download is silent
  too, except from the menu, which then offers the page.
- **Told once per build.** The automatic check does not repeat a build it already named; the menu's
  check always answers.
- **The person can turn it off**, with the menu's checkbox, kept in `updates.json` in the app's
  state folder. `K7_NO_UPDATE_CHECK` turns it off for a run, `K7_DOWNLOADS_URL` points it at another
  downloads page.
- The page Download opens is the app's own address, never one read from the answer.

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

Both happen in the system browser (`docs/signIn.md`, `docs/sync.md`), and the app waits on a
loopback port meanwhile. `src/accountStatus.ts` tells k7's pages where that stands, over
`studio:auth:status`, and the home page's account bar draws it beside its button
(`apps/k7/frontend/src/tabs/AccountStatusNote.tsx`): waiting, with **Cancel**, which closes the
port; then how it ended — signed in, paired, or why not (a typed address that is no server, a
browser trip left unfinished for ten minutes, a browser signed in as another account, a token the
local backend could not keep). The main process sends a code and the page words it, so the text is
in the person's language.

**The second browser trip is announced.** Right after a sign-in, pairing opens the browser again;
unexplained, that reads as the sign-in having failed. So the automatic pairing asks first, in a
native dialog, and Not now leaves the account unpaired until the next start, or Add a server on the
home page.
