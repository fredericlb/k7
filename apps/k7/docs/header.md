# The top bar

`apps/k7/frontend/src/views/HeaderView.tsx` mounts the shared `AppHeader`. Three choices are
made there, and this page exists to say which.

## They are ENTRIES, not controls

That is the line `AppHeader` draws, and it is the reason those particular items are the ones
that go behind the hamburger on a phone.

Below the breakpoint the bar folds its entries into a menu that **names** them, rather than
reducing them to a row of glyphs: a row of anonymous glyphs is a row nobody can read.

**Recordings** holds sessions and their moments on one timeline — a moment is a stretch of a
session, so it hangs under it (`recordings.md`). **Publications** holds releases and pages — a
page lists releases — as a tab each. Fewer entries is what keeps the bar from folding on a tablet
held upright. Every tab is still its own address (`/releases`, `/pages`), so a link to any of them
lands on it.

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
