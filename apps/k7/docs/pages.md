# Pages: a public list of releases

A page is a named list of releases (`Pages.ReleaseUids`), shared through one address:
`/@<nametag>`. Only its owner edits it (see [ownership.md](ownership.md)). Anyone with the link can
listen, and nobody has to sign in.

## In the app, pages group the releases

`apps/k7/frontend/src/views/PublicationsList.tsx` is the whole **Publications** entry, at
`/releases`: each page is a group of its releases, in the page's order, and after the pages come
the releases no page lists. A page is a selection of releases, so reading them apart — a Releases
tab and a Pages tab — made you rebuild that selection in your head. `/pages` survives as an address
and lands on `/releases`.

The groups start **collapsed**: the list is a table of contents of the pages first, and a release
on several pages would otherwise repeat down the screen. A release shows under every page that
lists it. The header toggles the group; opening the page itself is the button at its end.

## A page picks one version of each release

A release can have several versions: a rough mix, a master, a radio edit. The page says which
one it plays, in `Pages.VersionChoices`, a JSON map `{ releaseUid: versionUid }`. A release that
is missing from the map plays its **default**. The map lives on the page and not on the release
because two pages can show the same song differently: a demo for one audience, the master for
another.

**A hidden version** (`Versions.Hidden`) stays in its release and on the release page. It only
leaves every page's dropdown. If a page chose a version that is later hidden or deleted, that
page falls back to the default, and the owner never has to go back and fix it.
`shared/pageVersion.ts` makes this rule, and it is the only thing that does: the editor shows
its answer, and the public route serves it.

## The public route gives out only what the page offers

`/api/public/pages/:nametag` sends each release with the versions a visitor may pick
(`pageChoices`): every version that is not hidden, plus the one the page plays even if it is.
The page's pick comes first, as `defaultVersionId`, and it sends no owner id. A visitor can switch
versions, but the choice stays in their browser and is never saved. The audio, envelope and
download routes answer for those versions only, and send a 404 for any other. The owner hid a
version to keep it from the audience, and a guessed URL must not get around that.

**Downloading needs the release's own switch** (`canDownload`). The public download route checks
it on the server rather than trusting the missing button. It sends the same bytes as `/audio`,
as an attachment named `Artist - Title (Version).ext`.

## `/@<nametag>` is matched by hand

A React Router path cannot put a parameter after a literal `@` in the same segment, so
`/@:nametag` never matches. `main.tsx` checks the path itself, before `<App/>` mounts. `<App/>`
sends any visitor who is not signed in to the login page, and a public page must never go through
it.
