# The "autres applications" button

st0 is the studio's front door: it answers at the origin itself, with no path prefix.
So it is the one page that can reasonably carry a switcher to the origin's other apps,
and the header's `OtherApps` button is it — a menu with one row per app.

## What is in it, and what is not

Only **k7** and **z0**.

`l8` and `m9` are deliberately absent. Neither is a place you *visit*: both are opened
**on one project**, by st0, with launch parameters (`packages/project-shell/docs/launch.md`,
`apps/st0/docs/projects.md`). A bare link to `/l8` would land on an app with nothing to
open, which is a worse answer than no link at all. The repositories section is how you
get there, and it already knows which project you mean.

k7 and z0 have no such parameter: each has a home page that is meaningful on its own —
k7's session list, z0's game lobby — so a link is the whole navigation.

## Where the two paths come from

k7's comes from `SERVICE_PATHS` in `@studio/web-protocol/services`, the one table that
says where each studio service is mounted.

z0's is written out in `OtherApps.tsx` instead, and that is not an oversight. `SERVICE_PATHS`
is keyed by `StudioService`, which is the set of services that **share st0's session** — the
type also indexes `SERVICE_PORTS`, and a backend uses it to reach another backend. z0 has its
own login and its own `/z0/auth/callback` (see the Caddyfile), so it is not one of those.
Adding it to that table to save one string would claim a session and a port it does not have.
Its path is fixed all the same, by the same Caddyfile — it just is not that table's business.

## Same tab

The rows are plain `<a href>`, navigating in place, with `asChild` on the menu item so the
row *is* the anchor — middle-click and "open in new tab" keep working, and the browser's
back button returns to the médiathèque. Nothing in st0's header holds unsaved state that
leaving would lose.
