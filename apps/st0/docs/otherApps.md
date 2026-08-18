# The "autres applications" button

st0 is the studio's front door: it answers at the origin itself, with no path prefix.
So it is the one page that can reasonably carry a switcher to the origin's other apps,
and the header's `OtherApps` button is it — a menu with one row per app.

## What is in it

**l8**, **k7** and **z0** — every app on the origin that has a home page worth landing on.

`l8` was deliberately absent for a long time, and the argument was sound while it held: an
editor is opened **on one project**, so a bare link to `/l8` landed on an app with nothing to
open, which is a worse answer than no link at all. The repositories section, here, was how you
got there, and it already knew which project you meant.

That section is now l8's own home page (`apps/l8/frontend/docs/projects.md`), so `/l8` lands on
the list of repositories rather than on nothing — and this menu is the only door from the
médiathèque to one's own projects. It goes FIRST for that reason: k7 and z0 are places you go
occasionally, l8 is where the work is.

k7 and z0 never needed a parameter: each has a home page meaningful on its own — k7's session
list, z0's game lobby — so a link was always the whole navigation.

## Where the paths come from

l8's and k7's come from `SERVICE_PATHS` in `@studio/web-protocol/services`, the one table that
says where each studio service is mounted. The trailing slash is added here: `BASE_URL` spells
it that way, so the tab lands on the app's mount rather than on a redirect to it.

z0's is written out in `OtherApps.tsx` instead, and that is not an oversight. `SERVICE_PATHS`
is keyed by `StudioService`, which is the set of services that **share st0's session** — the
type also indexes `SERVICE_PORTS`, and a backend uses it to reach another backend. z0 has its
own login and its own `/z0/auth/callback` (see the LAN proxy), so it is not one of those.
Adding it to that table to save one string would claim a session and a port it does not have.
Its path is fixed all the same, by the same proxy config — it just is not that table's business.

## A new tab

The rows are plain `<a href>` carrying `target="_blank"`. All three are other
**applications**, not other pages of this one: you go and record a rehearsal, or run a blind
test, and the médiathèque is what you were doing before and what you come back to. It is the
front door — leaving it to visit a room of the same house is the wrong shape.

Navigating in place would also lose more than the scroll position and the open folder.
`PlaybackProvider` is mounted above the screens and holds the tab's `<audio>` when the
destination is the browser (see [miniPlayer.md](miniPlayer.md)), so a same-tab jump stops
whatever was playing. The back button brings the page back; it does not bring the music back.

`asChild` is still there and matters more now, not less: the row *is* the anchor, so
ctrl-click, middle-click and "copy link address" all mean what they say — a menu item that
merely *called* `window.open` would answer all three the same way, which is to say wrongly.

`rel="noopener"` severs `window.opener`. Same origin makes that access legal, not useful:
nothing here reaches back into the tab it came from, and saying so keeps the new tab a
browsing context of its own.
