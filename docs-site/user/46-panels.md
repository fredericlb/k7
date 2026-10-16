# Panels

A module's **panel** is the grid of controls drawn on its card in the chains view. It lives in the
module folder as `ui.k7x` (or `ui.yaml`). The [module builder](./45-module-builder.md) edits it
visually; this page is the reference for the file itself.

## A panel file

```js
// k7-core/modules/audio/compressor/engines/surge/ui.k7x
cols(4)
rows(4)
widgets({
  surge: { type: "knob", col: 0, row: 0, colSpan: 4, rowSpan: 4, label: "Surge", bind: "Surge", min: 0, max: 1 },
})
```

The same panel in YAML:

```yaml
cols: 4
rows: 4
widgets:
  surge: { type: knob, col: 0, row: 0, colSpan: 4, rowSpan: 4, label: Surge, bind: Surge, min: 0, max: 1 }
```

## Top-level fields

| Field | Meaning |
|---|---|
| `cols`, `rows` | The grid size. The horizontal layout has at most 4 rows. |
| `widgets` | The controls, by id. With tabs, these are drawn on every tab. |
| `tabs` | A list of pages: each has a `name` (1 to 10 characters, unique) and its own `widgets`. A single tab is never written. |
| `vertical` | The narrow layout: `cols` (at most 4), `rows`, `widgets`, and `tabs` with exactly the same names in the same order. Required when `cols` is more than 4. |

Both layouts must offer the same bound parameters, page by page.

## Widget types

| Type | What it draws |
|---|---|
| `knob` | A rotary control for one continuous parameter. |
| `slider` | A horizontal slider. |
| `fader` | A vertical fader, filling its height. Use it for EQ bands. |
| `number` | A number box. |
| `toggle` | An on/off switch. |
| `button` | A momentary button: 1 while pressed, then 0. |
| `meter` | Shows the bound parameter's value. |
| `dropdown` | A choice among named settings. |
| `filepicker` | Chooses a file the module loads (`model`, `onnx`). |
| `waveform` | The live audio at the module's input or output. |
| `lcdscreen` | A screen drawn by `widgets.js`. |
| `tap` | A rack pad. |
| `label` | Static text. |
| `group` | A tinted frame around other widgets. |

## Widget fields

| Field | Applies to | Meaning |
|---|---|---|
| `type` | all | Required. |
| `col`, `row` | all | Position, from 0. Required. |
| `colSpan`, `rowSpan` | all | Size in cells, default 1. |
| `label` | all | Caption. |
| `hidden` | all | Leave the widget out. |
| `bind` | value controls, groups, taps | The parameter it drives. Required on `filepicker`; not allowed on `lcdscreen`. |
| `min`, `max`, `step`, `curve` | knob, slider, fader, number | The range; `step` is positive; `curve` is `lin` or `log`. |
| `options` | dropdown | A list of `{ label, value }`, the value being a number. |
| `source` | waveform | `input`, `output` or `take`. |
| `text` | label | The text shown. |
| `color` | group | `#rgb`, `#rrggbb` or `#rrggbbaa`. |
| `bind` on a group | group | The section's on/off switch. |
| `invert` | group | The group's bind is a mute or bypass: the section is on while the parameter is off. |
| `pair` | knob | The dry parameter of a dry/wet crossfade knob, `bind` being the wet one. |

## Binds

`bind` is the parameter's exact name as the plugin reports it, with its case, spaces and
punctuation: `"Filter Freq"`, `"VCF Cutoff"`, `"Ensemble On/Off"`. A bind the plugin does not
have is a control that moves and does nothing, so check names in the builder's parameters list.

Names starting with `@` are settings k7 or the engine provides rather than the plugin:

| Bind | What it is |
|---|---|
| `@mix`, `@input-volume`, `@output-volume` | The engine's stage controls (shown in the card's footer). |
| `@base` | The named base the module starts from. |
| `@pan`, `@mute`, `@solo`, `@arm` | A lane's controls. |
| `@gain`, `@monitor`, `@channel` | A live input's gain (-24 to +24 dB), monitoring (`off`, `auto`, `on`) and channels. |
| `@rack:<symbol>`, `@rack+` | A rack pad, and the empty pad that adds one. |

## LCD screens

An `lcdscreen` widget is drawn by a function in the module's `widgets.js`, under the widget's id:

```js
// widgets.js
export default {
  comb(lcd) {
    const { ctx, width, height, params, output, state, now } = lcd;
    // draw on ctx, a 2D canvas context
  },
};
```

The function receives:

| Field | Meaning |
|---|---|
| `ctx`, `width`, `height` | A cleared 2D canvas context and its size in CSS pixels. |
| `params` | The module's parameter values by name, live where the engine reports them. |
| `input`, `output` | Recent peak levels entering and leaving the module (about 6 ms per point), oldest first. |
| `state` | A scratch object kept between draws. |
| `color` | The screen's palette: `ink`, `dim`, `glow`, `bg`. |
| `now` | The time of this draw, in milliseconds. |
| `sound(slot)` | A sound file the module names (for example a wavetable), decoded mono, or `null` until loaded. |

A screen can also be an object `{ draw, pointer }` to react to the pointer. The `pointer`
function receives the same frame plus `set(name, value)`, and an event with `type` (`down`,
`move`, `up`), `x`, `y`, `shift` and `alt`; it returns `true` when it took the event. Changes made
with `set` are heard at once and written to the module's file when the gesture ends.

Scripts run in an isolated sandbox with no network access, never in the page itself. A script
that hangs is stopped and not run again until its text changes.

A reserved `visible` function hides widgets depending on the module. For example, the amp module
shows only the knobs the loaded model was trained with:

```js
visible({ ampModel }) {
  if (!ampModel) return { screen_wide: false };
  return { knob_1: ampModel.knobs >= 1, knob_2: ampModel.knobs >= 2 };
},
```

An id it leaves out stays shown; if it throws, nothing is hidden.

## Inherited panels

A module that `extends` another inherits its panel. The top-level `widgets` merge by id: the
child can override a widget of its parent, add its own, or drop one with `hidden: true`.
