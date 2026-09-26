# AI organize — a panel designed by Claude

**AI organize** sends the module to Claude and replaces the panel with the one it answers: a
`ui.yaml`, and a `widgets.js` when the panel draws screens. It sits beside **Auto organize**
(`autoLayout.md`) and does not replace it. That one is instant, free and deterministic, and it
sorts every parameter into pages by its name. This one is slow and costs money, and it
*designs*: it picks the few controls that matter, groups them the way a hardware panel would, and
draws screens that show the sound's shape.

| file | holds |
|---|---|
| `src/aiPrompt.ts` | the system prompt: the grid, every widget, the lcdscreen contract, the design brief |
| `src/aiOrganize.ts` | the wire types, the per-module message, the check |
| `src/useAiOrganize.ts` | the builder's half: ask, send, land the answer in the buffers |
| `apps/st0/backend/src/aiOrganize.ts` | the host's half: the key, the model, the call, one repair round |

## The key lives on a server, so the button is the host's to offer

A Claude key cannot reach a browser. So the builder does not call Claude: it takes an optional
`onAiOrganize` and draws the button only when a host passes one, the rule `onScanParams` follows
(`builder.md`). st0 passes it when its backend says a key is configured. The médiathèque passes
nothing, and draws no button.

The backend reads two variables, from `env.yaml`'s `st0-backend` section or the environment:

| variable | |
|---|---|
| `ANTHROPIC_API_KEY` | required; unset, the route answers `enabled: false` and the button is not drawn |
| `ST0_AI_MODEL` | optional; `claude-opus-5` when unset |

The model variable is not `ANTHROPIC_MODEL` because a developer's shell often sets that one for
their own tools, sometimes to an alias the API refuses. A dev backend would then fail with a
message that points nowhere near the cause.

## The prompt is split into a constant half and a per-module half

The system prompt is the same text for every request, and nothing in it names a module, so it is
cached. The module arrives in the user message: its `module.yaml`, every parameter with its exact
name, its range or named states and its value, the panel and screens as they are now, and whatever
the author typed in the dialog.

**`WIDGET_DOCS` is keyed by the schema's `WidgetType`, and a test pins that it covers
`WIDGET_TYPES` exactly.** A widget kind added to the schema and not to the prompt would be one
the model never uses. Worse, a kind removed from the schema but still described would be one
that fails every load.

**The design brief is opinionated on purpose**: a modular layout with sections in signal-flow
order, knobs at 2×2, short hardware-style labels, plumbing left out, and screens in the idiom of
teenage engineering's OP-Z / OP-XY: black glass, 1 px white lines, flat shapes, a small palette
where one color means one parameter. A neutral brief gets a neutral panel, and a panel of
150 identical knobs is the one thing Auto organize already produces.

**Screens only where a picture says more than a knob.** The prompt names the cases: an envelope,
a filter curve, a waveform, a transfer curve, the level in against the level out. A screen that
prints numbers the knobs already show is clutter. A screen must also draw from params alone,
because in the builder there is no live plugin and its taps are empty (`ui-chains-react`'s
`lcdScreen.md`).

## The answer is checked, twice, against the loader's own rules

The model answers JSON (`AI_RESULT_SCHEMA`, enforced by structured outputs) and `checkAiResult`
refuses what would break the module:

- the schema's own refusals, with their paths, since `UiFileSchema` is what the loader runs;
- a widget outside the grid, or two on top of each other; a page is checked **together with the
  panel-level widgets**, because those are drawn over every page;
- an id used twice anywhere in the panel;
- a `bind` that is not one of the parameters sent: a panel bound to an invented name loads fine
  and does nothing, which no other check would catch;
- an lcdscreen with no draw function, and a `widgets.js` that does not compile. It is compiled
  with `new Function` and never called, so nothing the model wrote runs on the server.

The server runs the check and, on a refusal, sends the issues back to Claude in the same
conversation for **one** repair. One, because a second round of the same mistakes is rarely
worth another minute and another bill. The builder runs the check again on arrival, because a
host is not the builder's to trust.

## It streams, and it waits for Save

The route answers **NDJSON**: status lines while Claude thinks and writes, then one `done` or
`error`. A request with thinking can take over a minute. A silent socket that long is one a proxy
may cut, and a button that says nothing for a minute reads as a button that did nothing. Closing
the tab aborts the Claude request rather than paying for a panel nobody will see.

The answer lands in the **buffers**, the way a code edit does: the panel through the same path as
typing in the panel's pane, the script likewise. Nothing is on disk until **Save**, and Ctrl+Z in
the code pane takes it back. A panel with no screen leaves `widgets.js` alone. Emptying it would
dirty a stub, and the next save would write an empty file.

The dialog is one `askText`, and it does three jobs. It says what will happen, it asks first
when there is a panel to lose, and it takes the author's direction ("one page", "a big filter
screen"). An empty answer is a real answer: let the model choose.
