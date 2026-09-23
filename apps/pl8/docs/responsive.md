# pl8 on a narrow screen

The media library is hosted, so it opens from a phone as easily as from the desk — the only
studio screen of which that is true. The hazard is chrome: a tab strip, a 290 px tree column and
what borders it come to hundreds of pixels before the first pixel of content.

## One breakpoint, `md` (768 px)

Not three. Every step is a second layout to check, and what breaks here breaks all at once:
below, there is not room for every column at the same time; above, there is room for all of
them.

## The sections are one list, drawn by the shared bar

`SectionNav.tsx` holds the list; `@frediverse/ui`'s `AppHeader` renders both forms — a tab strip
above its breakpoint, a hamburger below. Two copies would diverge at the first section added,
and a section that exists on only one screen is one nobody finds.

- **Each section's count goes on the item's `trailing`**, an `AppHeaderItem` slot meant for it,
  not in the label. The label is what the menu ticks and what `aria-current` announces; a number
  folded into it reads as part of the page's name and changes whenever the catalogue does.
- **The current section's name is said**, as the bar's `subtitle`. A hamburger alone does not say
  where you are, which is the first question asked of a phone screen.
- **The sections' breakpoint is the bar's** (`sm`, 640 px), not this page's `md`. The bar is
  shared, so its step belongs to it: moving it for one app moves it for all.

## The tree becomes a drawer

290 fixed pixels leave nothing for content on a phone. Below `md` the `aside` leaves the flow and
becomes a drawer with its own button in the header — absent where there is no tree, the engine
and search screens drawing their own full width because nothing they show is on the volume.

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

## What goes, and in which order

What leaves first is what is never needed in the moment:

| element | threshold | why |
|---|---|---|
| the version | `lg` | nothing is decided on it |
| the section tabs | `sm` | they move into the shared bar's hamburger |
| the section name (subtitle) | 420 px | `AppHeader`'s threshold, not ours |

"Trouver des morceaux" and "Ajouter un morceau" left the header entirely — they sit at the foot
of the songs tree now, where there is room for the whole sentence at every width, so neither
collapses to an icon any more.

The song's two-pane editor **stacks** rather than splitting the width: two halves of a phone
screen are two columns nothing fits in. The YAML takes the top half and what it describes the
bottom — the same order as left to right.

## Not solved

The **waveform** pans and zooms with a mouse. It answers a finger for panning, but nothing is
done for pinch, and the transport controls are drawn at sizes meant for a cursor.
