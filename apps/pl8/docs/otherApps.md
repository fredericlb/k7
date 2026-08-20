# The "autres applications" button

pl8 was the studio's front door, and carried a switcher to the origin's other apps for that
reason. It is no longer the front door — **st0** answers the origin now, and this app sits under
`/pl8`, one button in st0's home-page header — but the menu stays, and its first row is what the
swap made most important: the way BACK to your own projects. The header's `OtherApps` button is
it, a menu with one row per app.

## What is in it

**st0**, **k7** and **z0** — every app on the origin that has a home page worth landing on.

`st0` was deliberately absent for a long time, and the argument was sound while it held: an
editor is opened **on one project**, so a bare link to `/st0` landed on an app with nothing to
open, which is a worse answer than no link at all. The repositories section, here, was how you
got there, and it already knew which project you meant.

That section is now st0's own home page (`apps/st0/frontend/docs/projects.md`), and that page is
the origin itself — `SERVICE_PATHS.st0` is the empty string, so this row's href is simply `/`.
It goes FIRST for that reason: k7 and z0 are places you go occasionally, st0 is where the work
is, and it is now also where you came FROM.

k7 and z0 never needed a parameter: each has a home page meaningful on its own — k7's session
list, z0's game lobby — so a link was always the whole navigation.

## Where the paths come from

st0's and k7's come from `SERVICE_PATHS` in `@studio/web-protocol/services`, the one table that
says where each studio service is mounted. The trailing slash is added here: `BASE_URL` spells
it that way, so the tab lands on the app's mount rather than on a redirect to it.

z0's is written out in `OtherApps.tsx` instead, and that is not an oversight. `SERVICE_PATHS`
is keyed by `StudioService`, which is the set of services that **share the studio session** — the
type also indexes `SERVICE_PORTS`, and a backend uses it to reach another backend. z0 has its
own login and its own `/z0/auth/callback` (see the LAN proxy), so it is not one of those.
Adding it to that table to save one string would claim a session and a port it does not have.
Its path is fixed all the same, by the same proxy config — it just is not that table's business.

## A new tab

The rows are plain `<a href>` carrying `target="_blank"`. All three are other
**applications**, not other pages of this one: you go and record a rehearsal, or run a blind
test, and the médiathèque is what you were doing before and what you come back to. Leaving it
to visit a room of the same house is the wrong shape — which is still true of the st0 row, even
though st0 is the front door now: what is playing here would stop.

st0's own link back the other way is deliberately the opposite, same tab: nothing is playing on
a list of repositories, so there is nothing to lose (`apps/st0/frontend/src/projects/Home.tsx`).

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
