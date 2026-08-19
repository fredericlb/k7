# A tabs widget's pages, and how the grid edits one

A `tabs` widget carries **pages**: named widget maps, of which the renderer draws one at a
time. The format has always allowed it (`WidgetSchema.pages`, recursive) and `DomChains`'
`TabsWidget` has always drawn it. What was missing was a way to put anything *in* a page:
the inspector could add, rename and delete pages, `addPage` wrote `{}`, and every widget you
dropped landed at the panel's top level. You could make tabs; you could not fill them.

## One map at a time

The grid edits **one widget map**, and `PageRef` says which: `null` for the panel itself, or
`{ tabs, name }` for a page. Two pure functions are the whole seam —

```ts
widgetsAt(ui, at)            // the map being edited
writeWidgetsAt(ui, at, next) // that map, put back where it came from
```

— and every operation goes through them: add, delete, bind a dropped parameter, move, resize.
None of them knows where it is. That is the point: the alternative was a branch in each of
the six, which is how five of them stay right and the sixth quietly writes to the panel.

`writeWidgetsAt` spreads at every level, and `widgetPages.test.ts` holds it to that. Writing
`pages: { [name]: next }` instead would drop the tabs widget's **other** pages — with nothing
on screen to say so until the file is saved and a page nobody was looking at has gone.

## What a page's coordinates mean

`col`/`row` inside a page are the **panel's** grid, not an offset inside the tabs widget's
box. That is the renderer's rule, not a convention this editor invented: `TabsWidget` gives
each sub-widget `left: sr.x - box.left`, which cancels the box's own position and lands the
widget where the panel's grid puts it. So the tab bar is a *selector*, and moving or resizing
it never moves the page content.

It is also why the grid draws the panel's own widgets **behind** a page, dimmed and inert. A
module shows them whichever page is up, so editing a page against a blank grid would hide
every collision until you looked at the real panel. The tabs widget itself is left out of that
backdrop: it is the bar, not content beside it.

## One level, deliberately

The one thing that fills pages in bulk is **Auto organize**, which proposes a whole panel — one
tabs widget, one page per family of parameters — from the parameter list alone. It writes the
same shape this grid edits, and it obeys the coordinate rule above: see `autoLayout.md`.

`pages` nests — a tabs widget inside a page is legal YAML — but the **Add** button refuses
`tabs` while you are on a page, disabled with a reason rather than silently doing nothing. A
grid that could descend forever needs a breadcrumb nobody can read at a glance, and nothing
has asked for the second level. Hand-write it in `ui.yaml` if you ever need one; the renderer
recurses already.

## The stale ref

The page is component state and the document arrives from outside — a save, a re-read, another
tab. So `at` is the ref **checked against the document** on every render, and a page whose
tabs widget or name has gone takes the grid back to the panel instead of writing into a map
that is not there. `writeWidgetsAt` refuses the same case a second time, returning `ui`
untouched: a widget map grown under an id the panel does not have would be a widget nothing
draws and nobody can find.
