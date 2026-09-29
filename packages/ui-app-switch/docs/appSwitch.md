# The app switch

One button, in the header of every app that has somewhere to go: a menu with a row per app on
the origin, minus the one drawing it. **st0's home page, pl8's header and k7's header mount the
same component**, which is the whole reason this is a package — the switch is about the ORIGIN and
its four apps, so an app-local copy would be one table of addresses per app.

## What is in it

**st0**, **pl8**, **k7** and **z0** — every app on the origin that has a home page worth landing
on, and the host's own row is dropped by `self` rather than by four separate tables.

The st0 row goes first, and is worth a link because it lands on something: st0's home page lists
the account's repositories and the projects in them (`apps/st0/frontend/docs/projects.md`), and
that page IS the origin — `SERVICE_PATHS.st0` is the empty string, so this row's href is simply
`/`. A bare link to an editor with nothing to open would be a worse answer than no link at all; a
link to the list of what one can open is not. k7 and z0 are places you go occasionally, st0 is
where the work is, and — from anywhere but st0 — where you came FROM.

None of the rows takes a parameter: each app has a home page meaningful on its own — pl8's
catalogue, k7's session list, z0's game lobby — so a link is the whole navigation.

The paths come from `SERVICE_PATHS` in `@studio/web-protocol/services`, the one table that says
where each studio service is mounted. The trailing slash is added here: `BASE_URL` spells it that
way, so the tab lands on the app's mount rather than on a redirect to it.

## A new tab

The rows are plain `<a href>` carrying `target="_blank"`. They are other **applications**, not
other pages of this one: you go and record a rehearsal, or run a blind test, and what you were
doing is what you come back to. Leaving in place would also lose more than the scroll position —
pl8 holds the tab's `<audio>` when the destination is the browser
(`apps/pl8/docs/miniPlayer.md`), and the back button brings the page back without bringing the
music back. It is also what the desktop app needs: `target="_blank"` is what it turns into
`shell.openExternal`, and these are hosted apps that its own origin does not serve.

`asChild` matters: the row *is* the anchor, so ctrl-click, middle-click and "copy link address"
all mean what they say — a menu item that merely *called* `window.open` would answer all three
the same way, which is to say wrongly.

`rel="noopener"` severs `window.opener`. Same origin makes that access legal, not useful:
nothing here reaches back into the tab it came from, and saying so keeps the new tab a browsing
context of its own.

## `origin`, and the day there is none

Hosted, the four apps share one origin and every row is a same-origin path — `origin` is left
out and the links are relative. On the **desktop** they are not: that app serves st0's bundle
locally and nothing else, so the hosted apps answer on the PAIRED SERVER and every row is built
against it (`apps/st0/frontend/src/desktop.ts` holds the pairing).

Unpaired, there is no studio to switch to at all, and the caller says so through `unavailable`:
the button stays, disabled, carrying the sentence that names the fix. A menu of four links at a
503 would be four ways to find that out the hard way.
