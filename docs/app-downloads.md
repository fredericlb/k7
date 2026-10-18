# App downloads and desktop updates

Every build `desktop.yml` publishes — the desktop installers, the APK, the command-line engine —
is also published on k7 itself, at **`https://k7.rocks/app_downloads`**: one page anyone can open,
no login, and the feed the desktop app updates itself from. The GitHub release stays; the page is
the address to give people, and the one the installed apps read.

## Two channels

A build is named by its release stamp ([versioning.md](versioning.md)), and the stamp says its
channel: `vX.Y.Z` is **`release`**, `snapshot-<commit>` is **`snapshot`**. The page shows both, the
release first. A desktop app follows its own channel and never crosses to the other.

| choice | why |
|---|---|
| a channel per stamp kind, not one feed | electron-updater installs only a higher semver, and a snapshot's version (`0.1.0-snapshot-9f2c1ab`) is a prerelease of the release it was cut from: on one feed, a release would pull every snapshot install onto it and leave it there |
| the app decides what is newer, then lets electron-updater download with `allowDowngrade` | snapshot versions sort by commit hash, not by date; the snapshot channel only ever holds `main`'s latest build, so "another commit" is "later", as the app's check already said |
| `current` and `previous` kept per channel, nothing else | an app that read `latest.yml` just before a publish still finds its installer; older builds are on GitHub |
| the root domain answers `/app_downloads` only (a Traefik router of its own) | `k7.rocks` is not otherwise k7's to serve; the app itself is at `app.k7.rocks`, which answers the same path |

## Publishing

`desktop.yml`'s `publish` job, after the GitHub release, sends every file of `dist/` to
`https://app.k7.rocks/api/app-releases/<stamp>/<file>` (one `PUT` each, raw body) and then `POST`s
`/api/app-releases/<stamp>/publish`, which switches the channel to that build at once.

Both need `Authorization: Bearer <APP_RELEASE_TOKEN>`, a value only the repository's
`APP_RELEASE_TOKEN` secret and the server's `APP_RELEASE_TOKEN` (`docker/.env`) know. Unset on the
server, every upload answers 401; unset in the repository, the step warns and skips, and the page
keeps its last build. To set it up, generate one value (`openssl rand -hex 32`) and put it in both.

**Nothing is signed, so the token is what keeps a bad build off the machines**: whoever holds it ships
code that every installed Windows app and AppImage runs at its next quit.

A file is at most `APP_RELEASE_MAX_MB` (2048); its name is letters, digits, `.`, `_` and `-`, which
is why electron-builder names the installers as `engine/scripts/package-release.mjs` does —
`latest*.yml` must name the very file the server holds. The builds live under
`STUDIO_APP_RELEASES_DIR`, `/data/app-releases` in the image (the `data` volume), one folder per
channel. The routes are `apps/k7/backend/src/appReleases/`; the desktop app's own backend does not
mount them.

## The desktop side

`apps/k7-standalone/src/updates.ts` asks `<channel>.json` a little after start and then every six
hours. On Windows (NSIS) and the AppImage it downloads the build with **electron-updater** and
installs it when k7 quits, or at once from a Restart now dialog. macOS refuses to let an ad-hoc
signed app replace itself, and a `.deb` belongs to apt: there the app says a newer k7 exists and
Download opens the page ([apps/k7-standalone/docs/notices.md](../apps/k7-standalone/docs/notices.md)).

The phones do not update from here: the APK is offered on the page, and the iPhone app ships
through Xcode.
