# The rehearsal entries of k7's sidebar

The rehearsal pages have no bar of their own: they are pages of k7's home, and their two entries
close the sidebar's top list, after **Frozen chains** and above the media library's group, with no
title of their own (`apps/k7/frontend/src/projects/HomeSidebar.tsx`). `src/sections.ts` says what the entries are and
which one an address belongs to; the host draws them. The red dot that starts a take is the
HOST's, not this group's: k7 draws it in the sidebar's foot on every home page, so a take starts
while one reads the media library or the settings (`apps/k7/frontend/src/projects/HomeFrame.tsx`).

## Two entries

| entry | opens | holds |
|---|---|---|
| Publications | `/rehearsal/releases` | releases, grouped by the pages that list them |
| Exercises | `/rehearsal/exercises` (`/rehearsal/exercices` redirects there) | singing exercises, random chords, the tuner |

The takes have no entry here. They are listed in the media library's **Recordings**, with every
other capture ([recordings.md](recordings.md)), and a recording's, a session's or a moment's page
lights that entry: `rehearsalSectionAt` answers `recordings` for them, which the host maps to its
own section. Fewer entries is the choice: a page is a selection of releases, so the releases are
listed under their pages. `/rehearsal/pages` still lands on its entry.

**The settings are a section of k7's `/settings`**, not a fifth entry: every page of the origin
keeps its settings in that one place (`apps/k7/frontend/docs/settings.md`), and
`/rehearsal/settings` sends there.

Every icon comes from `@frediverse/ui/icons`, the one set every frediverse app draws with — why,
and the sizes: `commons/packages/ui/docs/icons.md`.

## Publications: pages group the releases

`src/views/PublicationsList.tsx` is the whole **Publications** entry: each page is a group of its
releases, in the page's order, and after the pages come the releases no page lists. Reading them
apart — a Releases tab and a Pages tab — would make you rebuild that selection in your head.

The groups start **collapsed**: the list is a table of contents of the pages first, and a release
on several pages would otherwise repeat down the screen. A release shows under every page that
lists it. The header toggles the group; opening the page itself is the button at its end. What a
page is, and what its public address gives out, is `packages/rehearsal-server/docs/pages.md`.

## A detail page leads back to its entry

Every page under an entry opens its title row with an arrow back to that entry's list
(`src/components/BackButton.tsx`). It sits on the title's row, not above it, so it costs no height.
It goes to the entry's list rather than to the browser's history, so a link opened cold still lands
inside the rehearsal pages. The `/new` forms have Cancel instead, which is the same way out.

## The pages draw inside a wrapper

Every rehearsal screen is drawn inside `.rehearsal-root`, and its stylesheet (`src/styles/`) is
scoped under it: its palette as custom properties on the wrapper, and no `:root`, no `body`, no bare
element rule — a rule that reached k7's own pages would restyle them the moment a rehearsal page
had been opened once. The fixed docks and pop-ins are placed against the content column, which the
host makes their containing block; the take's overlay, outside it, reads the column's place from the
host (`audio.md`). 
The palette's short names (`--bg`, `--accent`…) READ the theme's `--sh-*` tokens rather than repeat
their values: a copy is a second palette that drifts the day the theme changes. And `.main-inner` is
the same column as k7's other home pages (`apps/k7/frontend/src/projects/PageFrame.tsx`), so moving
from Projects to Recordings does not shift where the page starts.
