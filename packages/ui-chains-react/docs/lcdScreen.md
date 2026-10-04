# The lcdscreen widget

An `lcdscreen` is a widget whose picture is **code the module ships**: a `widgets.js` beside the
module's `ui.yaml` returns an object keyed by widget id, and each value draws one screen.

```js
// _modules/audio/compressor/widgets.js
export default {
  screen(lcd) {
    lcd.ctx.fillStyle = lcd.color.ink;
    lcd.ctx.fillText(`${lcd.params.Ratio}`, 4, 12);
  },
};
```

```yaml
# ui.yaml beside it
screen: { type: lcdscreen, col: 0, row: 0, colSpan: 6, rowSpan: 3 }
```

`return { … }` works as well as `export default { … }`: the second is read as the first, so the
file is a module to an editor and a function body to the page.

## What a draw function gets

`LcdFrame` in `packages/ui-chains/src/lcdScreen.ts` is the contract: a cleared 2D context in CSS
pixels, the module's params by name, the peak history of both audio taps (`input`, `output`,
oldest first, ending now), a `state` object kept between draws, the screen's palette, and the time.

## An interactive screen

A screen written as `{ draw, pointer }` rather than a bare function also gets the pointer:

```js
export default {
  eq: {
    draw(lcd) { /* as above */ },
    pointer(lcd, ev) {
      // ev: { type: "down" | "move" | "up" | "wheel", x, y, delta, shift, alt }
      if (ev.type === "move") lcd.set("Mid Freq", 1200);
      return true;
    },
  },
};
```

`LcdPointerFrame` and `LcdPointerEvent` in `lcdScreen.ts` are that contract: the frame the draw
gets, without `ctx` and with `set(name, value)`, and a pointer in the draw's own pixels. The
Parametric EQ in the st0 library (`modules/audio/eq/eq/engines/parametric`) is the worked example.

## Hiding widgets: `visible`

The same file may answer which of the panel's widgets show, under the reserved key `visible`:

```js
// modules/audio/amps/neural-amp-modeler/widgets.js — one module for every model
export default {
  visible: ({ ampModel }) => {
    if (!ampModel) return {}; // no model read (none loaded, the builder's preview): show them all
    const n = ampModel.knobs;
    return { knob1: n >= 1, knob2: n >= 2, knob3: n >= 3 };
  },
};
```

`PanelFrame` and `PanelVisible` in `lcdScreen.ts` are the contract: the module's params and
assets, and `ampModel` — `{ kind, knobs }` — when it loads an amp model the file service could read
(`packages/song/src/ampModel.ts`). Each widget id answered `false` is not drawn; an id left out
stays. A screen cannot be called `visible`.

**It is code, not a YAML condition.** What decides a widget's presence is as open as what a screen
draws — here a file's contents, elsewhere a param's value — and a rule language in `ui.yaml` would
grow until it was a worse JavaScript.

**A rule that throws hides nothing.** A bug in the script must leave a card with too many controls,
never with none.

**Hiding is a view, not the schema's `hidden:`.** That flag drops a widget at compile, for every
use of the module; this one reads the node it is drawn for.

## Choices

**It binds nothing, and an interactive one sets params by NAME.** A screen has no `bind`: the
schema refuses one and the builder offers no field. A screen that edits sets whatever params its
picture is made of — an EQ point is a band's frequency AND gain — so one bind could not describe it.

**`set` is a knob's path, not a new one.** Live to the engine once per frame, an override so every
other widget on the card bound to that param moves with it, and one `node param` per param set when
the gesture ends — in sequence, since they write one file. A wheel has no release, so it is
written once the wheel has been still for `WHEEL_COMMIT_MS`. The host provides it through
`LcdSetContext`; a host that provides none gets screens that only draw.

**The pointer is bound natively on the canvas.** A press is stopped there, so it never pans the
graph or selects the node. A wheel is stopped only when the handler returns true: a screen that
ignores the wheel off its points leaves the graph's zoom working over it.

**AI organize makes one only when asked** (`packages/ui-module-builder/docs/aiOrganize.md`): a
screen that takes the pointer takes it from the graph too.

**The script is a sibling file, not YAML.** A picture is code; squeezing it into `ui.yaml` would
mean a string of JavaScript inside YAML that no editor highlights. It is found like the panel —
same folder, same precedence — and it rides on the panel as `ui.script` through every hop to the
browser, so it needs no route of its own and a node inherits it with its panel.

**The browser runs it with `new Function`.** It is the module author's code, trusted the way a
jsdsp module's DSP already is by the engine. A library you add is code you run. It is compiled
once per text, whatever the number of screens.

**Both taps, always.** What a dynamics module DOES is the difference between what enters and
what leaves, so a screen gets both rather than choosing one like a waveform widget. The engine
drains ~50 ms per frame, which is why the widget keeps the history (`LCD_HISTORY`, ~6 s) rather
than the script.

**It draws only when something moved** — a tap frame, a param, a drag, a resize — capped at the
graph's ornament rate. The loop rules are the waveform's (`waveformWidget.md`). A screen for a
module that is silent is a still picture.

**A draw that throws stops.** The error is printed on the glass and the function is not called
again until the script text changes: a throw per frame is a frozen tab.

**Taps are counted.** A screen and a waveform widget on one module share the engine's tap; the
client counts subscriptions so the first to unmount does not remove it from the other
(`packages/engine-browser/src/engine.ts`).

## In the builder

A panel that draws a screen earns a `widgets.js` tab beside the others, through the store's
`widgetsScript` call (`packages/ui-module-builder/docs/store.md`), saved with the rest by Save.
The preview card draws the script as typed. It has no live plugin behind it in st0, so its taps
are empty and it draws from params alone.
