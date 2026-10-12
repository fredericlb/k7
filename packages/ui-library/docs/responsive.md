# The library on a narrow screen

The media library is hosted, so it opens from a phone as easily as from the desk — the only
studio screen of which that is true. The hazard is chrome: the host's sidebar, a 290 px tree column
and what borders it come to hundreds of pixels before the first pixel of content.

## One breakpoint, `md` (768 px)

Not three. Every step is a second layout to check, and what breaks here breaks all at once:
below, there is not room for every column at the same time; above, there is room for all of
them.

## The sections are the host's nav

The section list is the host's to draw ([host.md](host.md)). In st0 it is the home sidebar, which
folds to an icon rail below `sm` with the counts dropped and the names kept as the entries' labels
(`apps/st0/frontend/docs/projects.md`). The count goes beside a label, never into it: the label is
what `aria-current` announces, and a number folded into it reads as part of the page's name and
changes whenever the catalogue does.

## The tree becomes a drawer

290 fixed pixels leave nothing for content on a phone. Below `md` the `aside` leaves the flow and
becomes a drawer with its own floating button at the bottom left — absent where there is no tree,
the playlists and search screens drawing their own columns because nothing they show is a family
walk.

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
