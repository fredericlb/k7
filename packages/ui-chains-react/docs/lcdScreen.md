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

## Choices

**It binds nothing.** A screen shows a module's state, it does not drive a param; the schema
refuses a `bind` on one, and the builder offers no bind field.

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
