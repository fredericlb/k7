# The top bar

`apps/k7/frontend/src/views/HeaderView.tsx` mounts the shared `AppHeader`. Three choices are
made there, and this page exists to say which.

## They are ENTRIES, not controls

That is the line `AppHeader` draws, and it is the reason those particular items are the ones
that go behind the hamburger on a phone.

Below the breakpoint the bar folds its entries into a menu that **names** them, rather than
reducing them to a row of glyphs: a row of anonymous glyphs is a row nobody can read.

**Recordings** holds sessions and their moments on one timeline — a moment is a stretch of a
session, so it hangs under it (`recordings.md`). **Publications** holds releases grouped by the
pages that list them (`pages.md`). Fewer entries is what keeps the bar from folding on a tablet
held upright. The old list addresses (`/moments`, `/pages`) still land on their entry.

**Settings is a page reached from the user menu**, the row under the email, and not a fifth
entry: the bar would fold sooner for a screen opened rarely, and every studio app keeps its
settings in the same place (`packages/ui-user-menu/docs/userMenu.md`). On `/settings` no entry is
lit.

The icons stay all the same, because an entry that is named **and** carries a glyph is found
faster than one that is only named.

Every icon, in the bar and elsewhere, comes from `@frediverse/ui/icons`, the one set every
frediverse app draws with — why, and the sizes: `commons/packages/ui/docs/icons.md`.

## No `variant`: `tint` is the house look

`tint` lays 20 % of the page's accent over the bar, so the bar belongs to the page instead of
sitting on top of it — which is what an app whose page carries the colour wants.

## The z-index goes up to 20

The shared bar sticks at `z-10`, which puts it under k7's own page layers. The
`className="z-20"` set here is what keeps it above them: remove it and it goes under.

## A detail page leads back to its entry

Every page under an entry — a session, a moment, a release, a page, a song, an exercise — opens
its title row with an arrow back to that entry's list (`apps/k7/frontend/src/components/BackButton.tsx`).
It sits on the title's row, not above it, so it costs no height. It goes to the entry's list rather
than to the browser's history, so a link opened cold still lands inside k7.

Settings has none: it is reached from the user menu, not from an entry, and the entries are right there.
The `/new` forms have Cancel instead, which is the same way out.
