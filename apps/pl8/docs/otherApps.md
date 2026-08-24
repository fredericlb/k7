# The "autres applications" button

**st0** answers the origin, and this app sits under `/pl8`, one button in st0's home-page header.
The header's `OtherApps` button is the way back out: a menu with one row per app on the origin,
and its first row is the important one — the way BACK to your own projects.

## What is in it

**st0**, **k7** and **z0** — every app on the origin that has a home page worth landing on.

The st0 row is worth a link because it lands on something: st0's home page lists the account's
repositories and the projects in them (`apps/st0/frontend/docs/projects.md`), and that page IS
the origin — `SERVICE_PATHS.st0` is the empty string, so this row's href is simply `/`. A bare
link to an editor with nothing to open would be a worse answer than no link at all; a link to
the list of what one can open is not.

It goes FIRST for that reason: k7 and z0 are places you go occasionally, st0 is where the work
is, and it is also where you came FROM.

k7 and z0 need no parameter either: each has a home page meaningful on its own — k7's session
list, z0's game lobby — so a link is the whole navigation.

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
to visit a room of the same house is the wrong shape — the st0 row included, front door or not:
what is playing here would stop.

st0's own link back the other way is deliberately the opposite, same tab: nothing is playing on
a list of repositories, so there is nothing to lose (`apps/st0/frontend/src/projects/Home.tsx`).

Navigating in place would also lose more than the scroll position and the open folder.
`PlaybackProvider` is mounted above the screens and holds the tab's `<audio>` when the
destination is the browser (see [miniPlayer.md](miniPlayer.md)), so a same-tab jump stops
whatever was playing. The back button brings the page back; it does not bring the music back.

`asChild` matters: the row *is* the anchor, so
ctrl-click, middle-click and "copy link address" all mean what they say — a menu item that
merely *called* `window.open` would answer all three the same way, which is to say wrongly.

`rel="noopener"` severs `window.opener`. Same origin makes that access legal, not useful:
nothing here reaches back into the tab it came from, and saying so keeps the new tab a
browsing context of its own.
