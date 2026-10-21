# The About page, and where its notices come from

`/about` is a page of the home, like `/settings` (`src/about/AboutPage.tsx`): k7's name and
version, its licence with the full text, the link to its source, and every third-party notice.
It is reached from the user menu, the row under Settings, because that menu is where every page
of the origin keeps the things you visit on purpose and rarely. The word is reserved in
`packages/web-protocol/projects.ts`, so a reload or a pasted link lands on it.

## The version

The page reads `src/version.ts` and nothing else. That module is the frontend's one version
source, whatever the build feeds it (`../../../../docs/versioning.md`); a second reading of a
`package.json` here would be a second answer the day the two differ. Under the tray the
release of the tray is shown beside it, as on the settings page (`GET /api/local`, `localApp.md`).

## Why the source link is there

k7 is GPLv3, and the engine links JUCE, which is AGPLv3. The AGPL asks that whoever uses the
program over a network — the server's own engine, played from a browser — be offered its
complete source. The link to `https://github.com/fredericlb/k7` on this page is that offer, so
it is drawn on every instance, the hosted one first.

## The notices are BUILT, not checked in

`notices/vitePlugin.ts` serves `virtual:k7-notices`, computed by `notices/collect.ts` from the
tree the build sees. A checked-in list would drift from the lockfile the first time a
dependency moved; a built one cannot. A build refuses a production dependency whose licence
nobody can name — the app ships nothing it cannot account for — while the dev server only warns.
A manifest that names no licence is read by hand and written into `npmOverrides`, with why.

The npm half is the `dependencies` closure (optional and peer dependencies included, dev
dependencies not) of every app that ships: the frontend, k7's backend (which the tray ships, with the frontend inside it), the
Android shell, and `packages/song-strudel`, which is bundled into the engine. It is walked on
disk rather than read from the lockfile because the licence TEXT is a file in the package, and
because a platform's binaries are then the ones that platform actually installed. Workspace
packages are ours and are walked through, never listed. The list over-approximates what the
browser bundle holds, which is the safe direction for a notice.

## The hand list, and what keeps it honest

What npm does not install is `notices/components.json`: the libraries CMake fetches for the
engine and its supervisor, the Termux packages of the phone, the OS packages of the two runtime
images, the fonts and sound font alphaTab copies in. Each names its licence, where it
ships, and its own notice under `notices/texts/`. `collect.test.ts` fails when a
`FetchContent_Declare`, a pinned Termux package, or an `apk`/`apt` package of a runtime image has
no entry, and when a hand-written version is no longer in the file that pins it. A version the
tree already pins elsewhere (Termux, alphaTab) is READ from there, never copied.

`notices/vendor.ts` refreshes the engine's notices from the licence files in an engine build's
`_deps` — the library's own and those of the submodules it compiles in. It is run by hand after
a bump, since a build of the engine is what holds those files.

## Standard texts are stored once

A GPL, AGPL, LGPL, MPL, Apache, OFL or Unlicense text is in `notices/licenses/` once, and an
entry names it by SPDX id, `-only` and `-or-later` folded together. GPL-3.0 is the root
`LICENSE` itself. A component's own file is kept as its notice, since an MIT or BSD text differs
by its copyright line; identical files are stored once whatever package carries them. A text is
rendered only while its row is open, since the data is over a megabyte. It is a chunk of its
own, out of the entry and out of the home page: about 100 KB once compressed, which the service
worker precaches like every other chunk so a deploy never leaves the page without it.

## What it does not cover

The Debian packages of the engine image keep theirs under `/usr/share/doc`: the
page says so rather than carrying tens of megabytes. The iPhone app's NodeMobile is not listed,
and neither are the web fonts the page links from Google Fonts, which are served, not shipped.
The command-line engine's archive carries no page; its notices are the engine rows here.
