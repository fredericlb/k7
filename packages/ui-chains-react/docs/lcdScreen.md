# The lcdscreen widget

An `lcdscreen` is a widget whose picture is **code the module ships**: a `widgets.js` beside the
module's `ui.k7x` returns an object keyed by widget id, and each value draws one screen.

```js
// _modules/audio/compressor/widgets.js
export default {
  screen(lcd) {
    lcd.ctx.fillStyle = lcd.color.ink;
    lcd.ctx.fillText(`${lcd.params.Ratio}`, 4, 12);
  },
};
```

```k7x
// ui.k7x beside it
screen({ type: "lcdscreen", col: 0, row: 0, colSpan: 6, rowSpan: 3 })
```

`return { … }` works as well as `export default { … }`: the second is read as the first, so the
file is a module to an editor and a function body to the page.

## What a draw function gets

`LcdFrame` in `packages/ui-chains/src/lcdScreen.ts` is the contract: a cleared 2D context in CSS
pixels, the module's params by name, the peak history of both audio taps (`input`, `output`,
oldest first, ending now), a `state` object kept between draws, the screen's palette, and the time.

The context is an `OffscreenCanvasRenderingContext2D`, and the script runs in a worker of the
widget sandbox (below): it has no `window`, no `document`, no storage and no network. What it
draws with is the frame it is handed, and nothing else.

`lcd.sound(slot)` is the one thing a screen asks for rather than receives: the FILE a slot of the
module names — a Faust table — decoded mono at its own length, or `null` until it has loaded (or
with a host that loads none). The host decodes (`LcdSounds`, handed to `DomChains` as `sounds`, or provided once ABOVE every
graph through `LcdSoundsContext` — k7 does the latter, since it mounts graphs in five places and a
host passing it to four leaves the fifth's screens loading for ever);
k7's reads the WAV itself (`apps/k7/frontend/src/lcdSounds.ts`), because the browser's
`decodeAudioData` resamples to the context's rate and a 2048-sample frame would stop being one. A
file landing repaints every screen, so a draw only has to handle the `null` it starts with. The
library's wavetable instrument draws its table with it.

## An interactive screen

A screen written as `{ draw, pointer }` rather than a bare function also gets the pointer:

```js
export default {
  eq: {
    draw(lcd) { /* as above */ },
    pointer(lcd, ev) {
      // ev: { type: "down" | "move" | "up", x, y, shift, alt }
      if (ev.type === "move") lcd.set("Mid Freq", 1200);
      return true;
    },
  },
};
```

`LcdPointerFrame` and `LcdPointerEvent` in `lcdScreen.ts` are that contract: the frame the draw
gets, without `ctx` and with `set(name, value)`, and a pointer in the draw's own pixels. The
Parametric EQ in the k7-core library (`modules/audio/eq/eq/engines/parametric`) is the worked example.

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

**It is code, not a condition in the panel file.** What decides a widget's presence is as open as what a screen
draws — here a file's contents, elsewhere a param's value — and a rule language in `ui.k7x` would
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
the gesture ends — in sequence, since they write one file. The host provides it through
`LcdSetContext`; a host that provides none gets screens that only draw.

**The pointer is bound natively on the canvas.** A press is stopped there, so it never pans the
graph or selects the node. **A screen takes no wheel**: the wheel is the graph's zoom, and a screen
that took it — even only over its points — made zooming over a card depend on where on the card the
pointer happened to be. Whatever a wheel would set is a drag or a knob instead.

**AI organize makes one only when asked** (`packages/ui-module-builder/docs/aiOrganize.md`): a
screen that takes the pointer takes it from the graph too.

**The script is a sibling file, not a k7x value.** A picture is code; squeezing it into `ui.k7x`
would mean a string of JavaScript inside a data file that no editor highlights. It is found like the panel —
same folder, same precedence — and it rides on the panel as `ui.script` through every hop to the
browser, so it needs no route of its own and a node inherits it with its panel.

**It never runs in the page** (*Where the script runs*, below). It is compiled once per text,
whatever the number of screens.

**Both taps, always.** What a dynamics module DOES is the difference between what enters and
what leaves, so a screen gets both rather than choosing one like a waveform widget. The engine
drains ~50 ms per frame, which is why the widget keeps the history (`LCD_HISTORY`, ~6 s) rather
than the script.

**It draws only when something moved** — a tap frame, a param, a drag, a resize — capped at the
graph's ornament rate. The loop rules are the waveform's (`waveformWidget.md`). A screen for a
module that is silent is a still picture.

**Its pixels follow the camera.** A card sits under the graph's CSS scale, and a canvas scaled by CSS
is blurred, so the canvas is sized for the screen's density TIMES the camera's zoom when it
magnifies (`lcdBackingScale` in `src/lcdZoom.ts`). Only the SETTLED zoom counts, published when the
camera comes to rest, as a store rather than React state: a glide would otherwise reallocate
every canvas each frame, and re-render the graph to do it. A screen stays a canvas rather than SVG
because it redraws at the ornament rate while audio flows, and the scripts are written against
`CanvasRenderingContext2D`. The larger side is capped at `LCD_MAX_BACKING` device pixels.

**A draw that throws stops.** The error is printed on the glass and the function is not called
again until the script text changes: a throw per frame is a frozen tab.

**Taps are counted.** A screen and a waveform widget on one module share the engine's tap; the
client counts subscriptions so the first to unmount does not remove it from the other
(`packages/engine-browser/src/engine.ts`).

## Where the script runs

Every `widgets.js` — its draws, its pointer handlers, its `visible` rule — runs in ONE hidden
`<iframe sandbox="allow-scripts" srcdoc=…>` per page, in a worker that iframe starts, and nowhere
else. The page half is `packages/ui-chains/src/widgetSandbox.ts`, the half inside is
`packages/ui-chains/src/widgetRuntime.ts`, and `src/widgetScript.ts` here is React's reading of it.

**Why not the page.** A library is ORIGIN-WIDE: every account reads it, and an admin edits it live
(`packages/song/docs/sharedFolders.md`); AI organize writes these scripts too. Code run in the page
runs with the page's session: it can call every API as the user and read the engine pairing kept in
`localStorage`. One compromised admin, or one untrusted seed, would be code in every user's
session. In the sandbox the script has an opaque origin: no cookie, no storage, no reach into the
page.

**No network either.** The iframe's document carries its own CSP, `default-src 'none'` with only
inline and `blob:` scripts and `eval` allowed, which the worker inherits. An opaque origin alone
would still let a script send requests, and the hosted session cookie is `SameSite=None`.

**A worker, so a hang is not the editor's.** An iframe often shares the page's thread, and a
`while (true)` in a draw would freeze both. Every request has a deadline
(`SANDBOX_TIMEOUT_MS`); the first one missed throws the iframe away with its worker, builds a new
one, and that script TEXT is never sent again in this page — its screens say it was stopped, its
`visible` hides nothing. The request blamed is the oldest unanswered one, which is the one the
sandbox is stuck in, since it answers in order. Where a worker cannot start, the runtime runs in
the iframe itself and still works, but a hang is then contained only if the browser gives the
iframe a process of its own.

**A draw answers with a bitmap.** The sandbox draws on an `OffscreenCanvas` of its own and
TRANSFERS `transferToImageBitmap()` back; the page shows it through a `bitmaprenderer` context.
Handing the page's canvas over with `transferControlToOffscreen` is the cheaper-looking path and is
not taken: a canvas transferred into a cross-origin frame stops answering after its first frame in
Chrome (measured, headless and with a worker or without), and it could never be transferred again
after a rebuild. Serialised draw commands were not needed for any path: a `measureText` must answer
synchronously, which a command list cannot. The cost is one bitmap per frame, moved and not copied.

**Everything is asynchronous, and nothing waits.** A card shows every widget until the `visible`
answer lands, then re-renders once to hide; asked again with other params, it keeps the last answer
until the new one lands. Answers are cached by script and panel, so a card mounted again has its
answer on its first render. A screen keeps one draw in flight and coalesces the rest. A pointer
handler's `set` calls come back with its answer and are applied then, in order; the gesture is
written when the answer to its `up` has landed.

**Sounds cross once.** A screen sends a slot's samples only after its script has asked for that
slot, and only when they changed; the sandbox keeps them per screen.

**Messages are checked at both ends.** The page takes a message only from its iframe's window
(`MessageEvent.source`); the iframe takes one only from its `parent`. The page posts with
target `"*"` because an opaque origin has no name to target, which is acceptable because what
goes in is params, taps and sounds, never a secret.

## In the builder

A panel that draws a screen earns a `widgets.js` tab beside the others, through the store's
`widgetsScript` call (`packages/ui-module-builder/docs/store.md`), saved with the rest by Save.
The preview card draws the script as typed. It has no live plugin behind it in k7, so its taps
are empty and it draws from params alone.
