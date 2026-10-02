# A panel's tabs, and how the grid edits one

Tabs belong to the PANEL, not to a widget: `ui.yaml` carries an ordered `tabs:` list beside its
`widgets`, each a `name` and the widgets drawn while it is open. The top-level `widgets` are drawn on
every tab. The format is `UISchema` in `@studio/song-schema` (`packages/song-schema/docs/moduleFile.md`);
the card draws two or more tabs as a column down its left (`packages/ui-chains-react/docs/nodeCard.md`).

## Why the panel's and not a widget

A tab is not something placed on the grid. A tab bar placed as a widget takes a row from every page,
and lays the pages out around a bar that is itself one of the widgets — moving it moves nothing and
resizing it means nothing. So the tabs are a property of the panel, drawn beside the grid rather than
on it, and every tab has the whole grid from row 0.

## One tab is no tab

A panel with a single page writes **no** `tabs:` at all, and the card draws no column. The second tab
is what makes the list: `addTab` turns the panel's widgets into the first tab (`Main`) and opens an
empty second one. `removeTab` folds back the other way — down to one tab, the list goes and that
tab's widgets join the panel's. So there is one way to write a one-page panel, and a module never
carries a column with a single entry in it.

## One map at a time

The grid edits **one widget map**, and `PageRef` says which: a tab by position, or `null` for the
widgets every tab shows. Two pure functions are the whole seam —

```ts
widgetsAt(ui, at)            // the map being edited
writeWidgetsAt(ui, at, next) // that map, put back where it came from
```

— and every operation goes through them: add, delete, bind a dropped parameter, move, resize, paste.
None of them knows where it is; the alternative was a branch in each, which is how five stay right
and the sixth quietly writes to the panel. `panelTabs.ts` holds both, and the tab edits beside them.

A widget's id is unique across the WHOLE panel, every tab included: it is the override key and what
MIDI control and the automation arrow look a control up by. So a new widget's id is chosen against
`panelIds`, never against the open tab alone.

## The column, and its edits

`TabsColumn` sits at the grid's left as the card's column does: "Every tab" for the shared widgets,
then the tabs in order. The open tab is renamed in place (`renameTab`: trimmed, cut to ten characters,
refused when empty or another tab's), moved up or down (`moveTab`), or removed — with a question
first when it holds widgets, since they go with it. Ten characters is what the card's fixed column
holds; a longer name is refused by the schema rather than ellipsed, because a tab you cannot read is
not one you can choose.

While a tab is open the grid draws the shared widgets **behind** it, dimmed and inert: the module
shows them on every tab, so editing a tab against a blank grid would hide every collision until you
looked at the card.

## The stale ref

The open tab is component state and the document arrives from outside — a save, a re-read, another
editor. So `pageIn` checks it against the document on every render: nothing chosen, or a tab that has
gone, takes the grid to the first tab. `writeWidgetsAt` refuses the same case a second time,
returning `ui` untouched, since a tab grown at a position the panel does not have would be widgets
nothing draws.
