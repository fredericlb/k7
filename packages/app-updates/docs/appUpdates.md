# How the Electron apps keep themselves current

The desktop app (`apps/k7-standalone`) and the tray (`apps/k7-tray`) **update themselves where
they can**, from `https://k7.rocks/app_downloads`, the page every build is published on
(`docs/app-downloads.md` at the root, which also says what guards it: nothing is signed, so the
upload token is what keeps a bad build off the machines). Both run this package, so they behave
the same; each app only names its feed and what the dialogs call it.

| app | feed | dialogs say |
|---|---|---|
| desktop app | `app_downloads/<channel>` | k7 |
| tray | `app_downloads/tray/<channel>` | k7 tray |

## The stamp and the channel

A build's identity is its **release stamp**, `vX.Y.Z` for a tag and `snapshot-<commit>` for a push
to `main`, inlined by each app's `scripts/build-main.mjs` as `__K7_RELEASE__` (`src/release.ts`);
anything but those two shapes is `dev`, which asks nothing. The stamp picks the channel: a tagged
build follows `release` and compares tags by number; a snapshot follows `snapshot` and takes any
other commit as later, since that channel only ever holds `main`'s latest build
(`src/updateCheck.ts`, tested).

## What happens

`src/updates.ts` asks the channel's `<channel>.json` a few seconds after every start, then at most
every six hours.

| install | what happens |
|---|---|
| Windows (NSIS), AppImage | electron-updater downloads the build in the background and installs it when the app quits; a dialog offers Restart now |
| macOS, `.deb` | a dialog says a newer build exists; Download opens the page in the system browser |

macOS refuses to let an ad-hoc signed app replace itself, and a `.deb` belongs to apt, so neither is
downloaded for the person.

- **Silent when it cannot ask.** Offline or k7.rocks down: nothing is said and the next check
  retries. Only the menu's Check for Updates… says "could not reach". A failed download is silent
  too, except from the menu, which then offers the page.
- **Told once per build.** The automatic check does not repeat a build it already named; the menu's
  check always answers.
- **The person can turn it off**, with the menu's checkbox, kept in `updates.json` in the app's
  state folder. `K7_NO_UPDATE_CHECK` turns it off for a run, `K7_DOWNLOADS_URL` points it at another
  downloads page (the tray's feed follows, under `tray/`).
- The page Download opens is the downloads page this package names, never one read from the answer.

## Choices

| choice | why |
|---|---|
| one package for both apps, not a copy per app | two copies of a self-updater drift, and the one that drifts is the one that stops updating — silently, on machines nobody watches |
| the app decides what is newer, then lets electron-updater download with `allowDowngrade` | a snapshot's semver (`0.1.0-snapshot-9f2c1ab`) sorts by commit hash, not by date |
| one updater per process | electron-updater's `autoUpdater` is a singleton |
| an app passes its own log | the tray's lines belong in the merged log, in the supervisor's format, which the web Logs panel parses |
