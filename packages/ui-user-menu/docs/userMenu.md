# The user menu

One button in every studio app that has somewhere to go: the signed-in account's email, the app's
settings, a row per app on the origin minus the one drawing it, and the logout. **No studio
header has a settings button of its own**: the host hands `onSettings` its own navigation, so the
settings are found the same way everywhere.

Other pages of the SAME app go in `items`, as rows under Settings: k7 in the desktop app adds
**Engine** there (`apps/k7-standalone/docs/engine.md`). They are callbacks into the host's router,
where the app rows are links to other apps.

The menu itself — the email heading, the rows opening in a new tab, the logout, the notice in
place of the rows — is `@frediverse/ui/user-menu`, shared with phare
(`commons/packages/ui/docs/user-menu.md`). This package holds what only studio knows: which apps
the origin has and where each one answers. That is the whole reason it is a package — an
app-local copy would be one table of addresses per app.

k7 draws it at the foot of its home sidebar, so on the home page and every page that shares that
sidebar — `/libraries`, `/tasks`, `/settings`, the media library under `/media` and the rehearsal
pages under `/rehearsal` — not on `/external`, a second device's page, and not in an opened
project: the editor's header has no room for a menu that leaves the session.

## The account and the logout

Its words are the host's: `label` (the trigger's name), `settingsLabel` and `logoutLabel` are passed
through to `@frediverse/ui`'s menu, whose English defaults are what a host that passes none shows.

k7 asks `/auth/me` on its own origin and, after signing out, reloads onto its sign-in screen. The
session cookie is shared by everything on the origin, so logging out of one app logs out of all.

## The app rows

**k7** — the one app on the origin that has a home page worth landing on, and the host's own
row is dropped by `self` rather than by a table per host, so k7's own menu shows none. The
médiathèque and the rehearsal recorder have no row: they are parts of k7, reached from k7's
sidebar.

The k7 row is worth a link because it lands on something: k7's home page lists the account's
workspaces and the projects in them (`apps/k7/frontend/docs/projects.md`), and that page IS the
origin, so this row's href is simply the origin's root. From anywhere but k7, it is where you
came FROM.

The row takes no parameter: k7's home page is meaningful on its own, so a link is the whole
navigation. A new tab rather than in place
matters here in particular: the médiathèque holds the tab's `<audio>` when the destination is the
browser (`packages/ui-library/docs/miniPlayer.md`), and the rehearsal pages may hold a running
take.

The addresses come from `serviceUrl` in `@studio/web-protocol/services`, the one place that says
where each studio service answers. The trailing slash is added here: `BASE_URL` spells it that
way, so the tab lands on the app's mount rather than on a redirect to it.

## `origin`, and the day there is none

Hosted, the apps share one origin and every row is a same-origin path — `origin` is left out and
the links are relative. On the **desktop** they are not: that app serves k7's bundle locally and
nothing else, so the hosted apps answer on the PAIRED SERVER and every row is built against it
(`apps/k7/frontend/src/desktop.ts` holds the pairing).

Unpaired, there is no studio to switch to at all, and the caller says so through `unavailable`,
which becomes the shared menu's `notice`: the app rows give way to the sentence that names the
fix, while the account and the logout stay.
