# The user menu

One button at the top right of every studio app that has somewhere to go: the signed-in
account's email, the app's settings, a row per app on the origin minus the one drawing it, and
the logout. **No studio header has a settings button of its own**: st0, pl8 and k7 each hand
`onSettings` their own navigation, so the settings are found the same way in every app. **st0's
home page, pl8's header and k7's header mount the same component.**

The menu itself — the email heading, the rows opening in a new tab, the logout, the notice in
place of the rows — is `@frediverse/ui/user-menu`, shared with phare
(`commons/packages/ui/docs/user-menu.md`). This package holds what only studio knows: which apps
the origin has and where each one answers. That is the whole reason it is a package — an
app-local copy would be one table of addresses per app.

st0 draws it on the home page and the two pages that share its header, `/libraries` and
`/settings` — not on `/external`, a second device's page, and not in an opened project: the editor's header has no room for
a menu that leaves the session.

## The account and the logout

Each host asks `/auth/me` from a different origin — st0 same-origin, pl8 and k7 cross-origin with
credentials — and lands somewhere different after signing out: st0 and pl8 reload onto their
sign-in screen, k7 leaves for the origin's root. The session cookie is shared, so logging out of
one app logs out of all.

## The app rows

**st0**, **pl8**, **k7** and **z0** — every app on the origin that has a home page worth landing
on, and the host's own row is dropped by `self` rather than by four separate tables.

The st0 row goes first, and is worth a link because it lands on something: st0's home page lists
the account's repositories and the projects in them (`apps/st0/frontend/docs/projects.md`), and
that page IS the origin — `SERVICE_PATHS.st0` is the empty string, so this row's href is simply
`/`. k7 and z0 are places you go occasionally, st0 is where the work is, and — from anywhere but
st0 — where you came FROM.

None of the rows takes a parameter: each app has a home page meaningful on its own — pl8's
catalogue, k7's session list, z0's game lobby — so a link is the whole navigation. A new tab
rather than in place matters here in particular: pl8 holds the tab's `<audio>` when the
destination is the browser (`apps/pl8/docs/miniPlayer.md`).

The paths come from `SERVICE_PATHS` in `@studio/web-protocol/services`, the one table that says
where each studio service is mounted. The trailing slash is added here: `BASE_URL` spells it that
way, so the tab lands on the app's mount rather than on a redirect to it.

## `origin`, and the day there is none

Hosted, the four apps share one origin and every row is a same-origin path — `origin` is left
out and the links are relative. On the **desktop** they are not: that app serves st0's bundle
locally and nothing else, so the hosted apps answer on the PAIRED SERVER and every row is built
against it (`apps/st0/frontend/src/desktop.ts` holds the pairing).

Unpaired, there is no studio to switch to at all, and the caller says so through `unavailable`,
which becomes the shared menu's `notice`: the app rows give way to the sentence that names the
fix, while the account and the logout stay.
