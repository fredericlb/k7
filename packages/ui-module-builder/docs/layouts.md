# Two layouts: horizontal and vertical

A module's panel has two shapes, because a card is read two ways. In the per-track view on a desktop,
cards sit side by side in a row read ACROSS, so a card must be short. On a phone the per-track view is
read DOWN, and the global graph lays its cards in ranks left to right, so there a card must be narrow.

| layout | where it is drawn | its limit | its tabs |
|---|---|---|---|
| **horizontal** — the panel itself | the per-track view on a desktop | at most **4 rows** | a column at the card's left |
| **vertical** — `ui.yaml`'s `vertical:` block | the global graph, the per-track view on a phone | at most **4 columns** | a menu across the card's top |

```yaml
cols: 12          # the HORIZONTAL layout: this grid, at most 4 rows
rows: 4
widgets: { … }
tabs: [ … ]
vertical:         # the VERTICAL layout: at most 4 columns
  cols: 4
  rows: 9
  widgets: { … }
  tabs: [ … ]     # the same tabs, by name, in the same order
```

## One panel, two shapes

The two are the same panel, so `src/layoutTwins.ts` checks:

- **every page offers the same controls in both** — the same binds, counted, on the same tab. A knob
  missing from one shape is a control that disappears when the phone is turned. Frames (`group`) and
  `label`s are decoration and may differ freely;
- **the same tabs, by name and in the same order** (the schema refuses otherwise): a switch of layout
  must not land on another page;
- **a screen in the vertical layout reuses the panel's id**: `widgets.js` keys its draw functions by
  id, and a draw is scaled to whatever box it is given, so one function serves both shapes;
- the vertical layout's own geometry, as the panel's: inside its grid, nothing on top of anything, a
  widget wholly inside a frame or wholly outside it.

**`vertical` is omitted when the panel already fits both** — at most 4 rows AND at most 4 columns. A
panel wider than 4 columns without one is reported.

## Designing the vertical layout

The design brief that governs the panel (`src/aiPrompt.ts`, `aiOrganize.md`) governs this shape too:
sections in signal-flow order, each framed by a tinted `group`, knobs 2×2, faders only for bands,
screens only where a picture says more, no `@` controls. What changes is the direction: sections are
STACKED, top to bottom in the order the signal meets them, each as wide as the 4 columns allow. A 2×2
knob leaves room for two per line, so a section of six knobs is three lines. Faders for bands stay side
by side, at most four. A screen is as wide as the 4 columns, its height chosen for what it draws.

## When a module has no layout of that shape

Workspace modules, a VST scanned on the spot, a rack: whatever has no authored shape is FOLDED to it as
the view draws it (`ui-chains`' `gridFit.ts`) — 4 rows across, or 4 columns down. The fold never cuts a
control and does its best; an authored layout is always better, which is why every library module has
one.

## Checking the library

`npm run lint:layouts` (`npx tsx packages/ui-module-builder/scripts/checkLayouts.ts [module dirs…]`) checks every library panel
(or those named) against these rules and the brief's structural ones, and against the panel as the
library last committed it: every control the committed panel offered must still be offered somewhere.
