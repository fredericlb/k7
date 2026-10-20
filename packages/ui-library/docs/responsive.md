# The library on a narrow screen

The media library is hosted, so it opens from a phone as easily as from the desk — the only
studio screen of which that is true. The hazard is chrome: the host's sidebar, a 290 px tree column
and what borders it come to hundreds of pixels before the first pixel of content.

## One breakpoint, `md` (768 px)

Not three. Every step is a second layout to check, and what breaks here breaks all at once:
below, there is not room for every column at the same time; above, there is room for all of
them.

## The sections are the host's nav

The section list is the host's to draw ([host.md](host.md)). In k7 it is the home sidebar, which
folds to an icon rail below `sm` with the counts dropped and the names kept as the entries' labels
(`apps/k7/frontend/docs/projects.md`). The count goes beside a label, never into it: the label is
what `aria-current` announces, and a number folded into it reads as part of the page's name and
changes whenever the catalogue does.

## The tree becomes a drawer

290 fixed pixels leave nothing for content on a phone. Below `md` the `aside` leaves the flow and
becomes a drawer with its own floating button at the bottom left — absent where there is no tree,
the playlists and search screens drawing their own columns because nothing they show is a family
walk.

The playlists screen folds its two columns into one page at a time instead, with no drawer: the list
fills the screen until a playlist is open, then the playlist does, and the section's own entry in the
sidebar leads back to the list. Side by side below `md`, the open playlist got what the list's
290 pixels left of a phone, about a hundred and sixty, one word to a line.

It is the **same markup** in both cases with different classes. Extracting it to render twice
would duplicate the two hundred lines of menu actions it carries — the kind of duplication where
one copy gets a new action and the other does not.

The drawer closes on what it opens and on a section change. The veil exists **only** while it is
open: an invisible element covering the screen is one that swallows clicks.

**No `translate`, not even a zero one, sits on the `aside`.** `FileTree`'s own right-click popup
is `position: fixed`, expecting viewport coordinates — but a non-`none` `translate` value on an
ancestor (Tailwind's `translate-x-0` included, a literal `0px` and not the `none` keyword) makes
that ancestor the popup's containing block instead, per the CSS Transforms spec. The popup then
opens at the pointer's offset from the `aside`'s own box rather than the viewport's, which reads
as "the menu appears but not where I clicked."

## In the songs, the tree is the page

The songs section is the exception to the drawer. With no song open, its middle pane lists the
same songs the tree does, so on a phone it would open on a duplicate with the real list one button
away. Below `md`, the tree therefore takes the whole screen until a song opens; the song's editor
then replaces it, and its Back button returns to the tree. With a song open, the drawer is there
again, for moving to another song without going back. The other sections keep the drawer from
the start: their middle pane shows what the tree does not.

## A song row under a finger

- **A double tap plays the song**, starting its master on the account's destination, and opens
  nothing. A phone has no room for the panel and the tree at once, so playing a song should not
  cost the list. The price is a first tap that waits 300 ms, the double-tap window, before it opens
  the panel. Only a touch screen (`hover: none`) pays it: a mouse click opens at once, and a song
  with no master opens at once, since there is nothing to play. The tree's column is
  `touch-action: manipulation`, or iOS would zoom on the same gesture.
- **A long press is the right-click.** It is the tree's own (`commons/packages/ui/docs/file-tree.md`):
  500 ms held still opens the row's menu, and the lifting finger does not also open the song.

## What stays put

Adding a song and adding a capture are not in any bar — each sits below its tree, where there is room for the whole sentence at every width, so
none collapses to an icon. The `aside` is a column and not a single scroller
for exactly this: the tree has its OWN scrolling pane, so these buttons never travel with it — a
long library or a long capture history scrolls the rows, never the buttons under them.

The song's two-pane editor **stacks** rather than splitting the width: two halves of a phone
screen are two columns nothing fits in. The YAML takes the top half and what it describes the
bottom — the same order as left to right.

## Not solved

The **waveform** pans and zooms with a mouse. It answers a finger for panning, but nothing is
done for pinch, and the transport controls are drawn at sizes meant for a cursor.
