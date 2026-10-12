# The Rehearsal group of st0's sidebar

The rehearsal pages have no bar of their own: they are pages of st0's home, and their entries are
a group of its sidebar, **Rehearsal**, under the media library's
(`apps/st0/frontend/src/projects/HomeSidebar.tsx`). `src/sections.ts` says what the entries are and
which one an address belongs to; the host draws them. The page's own action — the red dot that
starts a take — sits where st0 puts a page's controls (`apps/st0/frontend/src/projects/RehearsalPage.tsx`).

## Four entries

| entry | opens | holds |
|---|---|---|
| Recordings | `/rehearsal/sessions` | sessions and their moments, one timeline ([recordings.md](recordings.md)) |
| Publications | `/rehearsal/releases` | releases, grouped by the pages that list them |
| Songbook | `/rehearsal/songs` | the shared songbook |
| Exercises | `/rehearsal/exercices` | singing exercises, random chords, the tuner |

Fewer entries is the choice: a moment is a stretch of a session, so it hangs under it rather than
being an entry of its own, and a page is a selection of releases, so the releases are listed under
their pages. `/rehearsal/moments` and `/rehearsal/pages` still land on their entry, and a detail
page — a session, a moment, a release, a page, a song, an exercise — lights the entry it belongs
to.

**The settings are a section of st0's `/settings`**, not a fifth entry: every page of the origin
keeps its settings in that one place (`apps/st0/frontend/docs/settings.md`), and
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
element rule — a rule that reached st0's own pages would restyle them the moment a rehearsal page
had been opened once. The fixed docks and pop-ins are offset by `--rehearsal-inset-left`, the
sidebar's width, so they stay inside the content column.
