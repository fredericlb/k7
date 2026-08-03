# The module editor's screen

## The tree stays

The editor used to `return` in place of the whole catalogue: header, tree and all. It sits
in the **middle** now, with the section tabs above it and the file tree beside it, so the
next module is one click away instead of a trip back through the catalogue and down the
tree again. Editing modules is rarely something you do to exactly one of them.

Three things follow from that, and none of them is cosmetic:

- **The engine picker is reachable while the editor is open.** It never used to be, and
  `useModuleEngine` was written on that assumption — it read the stored preference once and
  honoured it forever. A choice can now move under it, so the pick is threaded down from
  `Library` and the socket is rebuilt when it changes. A socket left on the previous machine
  would be answering for a plugin that is loaded somewhere else, which is worse than no
  engine at all: it looks like it is working.
- **The "un moteur est nécessaire" gate does not cover the editor.** It never did — the
  early return happened before it — and a deep link opens one past it either way. The
  builder already says for itself, in its footer, that an absent engine leaves the plugin's
  parameters empty.
- **The right-hand `ModuleParams` panel is hidden while editing.** The builder has a
  parameters pane of its own, and it is the one you can drag onto a widget. Two lists of the
  same thing, and the width belongs to the useful one.

## The four panes

```
┌───────────────┬───────────────┐
│  code   (70%) │ grid     (70%)│
├───────────────┼───────────────┤
│ params  (30%) │ graph    (30%)│
└───────────────┴───────────────┘
      50%              50%
```

Symmetric on purpose: each column is **the thing you edit** above and **what it produces**
below. On the left, the file's text and the parameters that text names. On the right, the
widget grid and the node that grid becomes.

The two halves of the width were already 50/50; the parameters pane went from 40% to 30% so
both bottom panes are the same height and the top two keep the majority.

## The graph preview

`ModulePreview.tsx` builds a `WebGraph` by hand — one source, one chain, one module, one
sink — and runs it through the same `buildGraph → layout → DomChains` pipeline pistes and
platines run. platines proved that shape works with no project folder behind it (see its
`docs/chains.md`); this is the second host to need it and the smallest one yet.

It is worth having beside the grid rather than instead of it because **the node is not the
grid**. `nodeSize` in `@studio/ui-chains` sizes a card from `cols × rows`, clamped to a
minimum width the header needs, so a panel that reads fine as an editing surface can come
out cramped or oddly proportioned as a card. The grid says where a knob goes; the preview
says what the module will look like to someone who never opens this screen.

Three details:

- It draws the grid **as edited, not as saved** — the whole point is to see a widget land
  before committing it. `renderPreview` is handed the builder's live `ui` state.
- `hidden` widgets are dropped here. A `WebModuleUI` has them resolved away already, by the
  compiler's merge of a module over the base it extends; there is no merge in this path, so
  without the filter the node would draw widgets the panel deliberately hides.
- The node carries the **real** engine address (`previewPluginId`), the one
  `useModuleEngine` loads the plugin at — not a look-alike. Nothing reads it back yet: the
  panel is read-only, and the widgets draw the values the file sets. Wiring
  `pluginParamsStore` / `setPluginParam` in is what would make it playable, and the address
  being right is what keeps that a small change rather than a rework.

## Why the builder does not own the graph

`ModuleBuilder` is shared with pistes, and it takes `renderPreview` rather than importing
the graph itself. `DomChains` requires `icons` — the glyphs are the **app's** vocabulary,
not the graph's, which is exactly why the component demands them and provides the context
itself (see `@studio/ui-chains-react/docs/hosting.md`) — and a `command` line, which the
médiathèque does not have. A shared package can invent neither.

So the builder owns the box and its 30%; the host owns what goes in it. Pass nothing, as
pistes does today, and the grid keeps the whole column.
