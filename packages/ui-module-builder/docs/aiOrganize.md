# AI organize — a panel designed by Claude

**AI organize** sends the module to Claude and replaces the panel with the one it answers: a
`ui.yaml`, and a `widgets.js` when the panel draws screens. It sits beside **Auto organize**
(`autoLayout.md`) and does not replace it. That one is instant, free and deterministic, and it
sorts every parameter into pages by its name. This one is slow and costs money, and it
*designs*: it picks the few controls that matter, groups them the way a hardware panel would, and
draws screens that show the sound's shape.

| file | holds |
|---|---|
| `packages/panel-rules/src/aiPrompt.ts` | the system prompt: the grid, every widget, the lcdscreen contract, the design brief |
| `packages/panel-rules/src/aiOrganize.ts` | the wire types, the per-module message, the check — in `@studio/panel-rules`, which the backend imports without React (`packages/panel-rules/docs/panelRules.md`) |
| `src/useAiOrganize.ts` | the builder's half: ask, send, land the answer in the buffers |
| `apps/k7/backend/src/aiOrganize.ts` | the host's half: the call, one repair round |
| `apps/k7/backend/src/aiSettings.ts` | the account's key and model, write-only from the browser |

## The key is the account's, and the button is the host's to offer

The builder does not call Claude itself. It takes an optional `onAiOrganize` and draws the
button only when a host passes one, the rule `onScanParams` follows (`builder.md`). k7 passes it
when its backend says this account has a key. The médiathèque passes nothing, and draws no
button.

**Each account sets its own key and model** in k7's settings page
(`apps/k7/frontend/docs/settings.md`), and k7's backend keeps them in a file per account
beside the preferences. An account is a person, and a request billed to somebody else's key is
one they never agreed to. Nothing in the server's environment has to change for one person to
turn the feature on. The model is optional: `claude-opus-5` when none is named.

**The key is write-only from the browser.** A read answers the model and a hint
(`sk-ant-…wxyz`), never the key. That is why the settings are not a field of the preferences
document: the browser reads that one whole and writes it back whole, so the key would travel to
every page that loads a preference. The settings route takes a PATCH instead. A field left out
is kept, and null clears it, because a browser that never holds the key cannot send it back to be
kept.

## The prompt is split into a constant half and a per-module half

The system prompt is the same text for every request, and nothing in it names a module, so it is
cached. The module arrives in the user message: its `module.yaml`, every parameter with its exact
name, its range or named states and its value, and whatever the author typed in the dialog — plus,
on an UPDATE, the panel and screens as they are now.

## Update or reset

A module whose panel already lays something out (`hasLayout`) is asked first which of the two it
wants — the dialog is project-shell's `askChoice` — because they are different requests, not one
request with an option:

- **Update** sends the current `ui.yaml` and `widgets.js`, and a sentence saying what should change,
  which is REQUIRED — the dialog refuses an empty one, and so does k7's backend: an update with
  nothing to change would pay a minute of the account's Claude for the panel it has. The message
  tells the model to change what is asked and keep every other widget id, position, size, bind and
  screen as it is. The answer still replaces the panel whole, so "keep" means "return it unchanged".
- **Reset** sends NEITHER file. A panel shown to the model is a panel it reuses, and a reset is a
  request for none of it. The direction stays optional: an empty one means "design it".

A panel with no widgets is not a layout, and goes straight to the reset's question.

## Or copy it for a local Claude Code session

The direction dialog has a second button, **Copy for Claude Code**, for either mode. It puts on the
clipboard what the API would have been sent — the same design brief (`aiDesignBrief`, the system
prompt without its answer format) and the same per-module message, update or reset — with one
section swapped: instead of "return a JSON object", **which files to write, and to write them
directly** (`claudeCodePrompt.ts`). The session writes the panel itself, checks it against the same
rules the builder applies — inside the grid, no overlap, one id each, the binds `bindableNames`
allows, a draw function per screen — and touches nothing else.

A file is named as a person finds it in a checkout, not by a disk path: the builder's paths are
workspace-relative, and a library module's `_libraries/<name>/…` is that library's own repository,
so it reads "`modules/…/ui.yaml` in the `k7-core` library repository". A disk path would be the server's,
which a local session cannot reach.

What it gives up is the builder's own check and its undo: the files change in the session's
checkout, and the builder shows them once the change reaches the studio — pushed there, pulled
here, then the builder's ↻ Refresh (`builder.md`). The status line says so on copying. The button is offered only once the panel has been read,
since before that there is no file to name.

**`WIDGET_DOCS` is keyed by the schema's `WidgetType`, and a test pins that it covers
`WIDGET_TYPES` exactly.** A widget kind added to the schema and not to the prompt would be one
the model never uses. Worse, a kind removed from the schema but still described would be one
that fails every load.

**The design brief is opinionated on purpose**: a modular layout with sections in signal-flow
order, each framed by a tinted `group` (a DRY/WET pair always), knobs at 2×2, short hardware-style
labels, plumbing left out, and screens in the idiom of
teenage engineering's OP-Z / OP-XY: black glass, 1 px white lines, flat shapes, a small palette
where one color means one parameter. A neutral brief gets a neutral panel, and a panel of
150 identical knobs is the one thing Auto organize already produces.

**No `@` controls.** The engine's stage around the module — `@input-volume`, `@mix`,
`@output-volume` — is drawn by k7 itself on the second line of the card's header (`packages/ui-chains-react/docs/nodeCard.md`),
and a lane's controls on its strip, so a panel holds none of them: a knob there would be a second
control for the same thing, placed wherever the model chose. `atControlIssues` refuses a knob,
slider, fader or number on any `@` param; a `@base` dropdown is not one of those and stays allowed,
and a rack pad has its own rule. The plugin's own input/output level, mix, dry and wet stay off too,
the stage's sliders replacing them (`levelIssues`, `blendIssues`) — their spelling changes from plugin to
plugin, and a small model follows the long brief in parts, so this is refused rather than asked.
On a module the engine offers no `@mix` (an instrument, or a host that offers none), the older
rule stands (`crossfadeIssues`): a param named *dry* and one named *wet*, with no *mix*, are one
crossfade knob, never two widgets.

**Knobs, and faders for bands.** Every continuous param is a knob, a gain or a mix included —
except a BAND: an EQ or tone control's `Low`, `Mid`, `High`, `Bass`, `Treble`, `Presence`, a shelf's
or a peak's gain, and a graphic EQ's, a filter bank's, a vocoder's or a multiband's per-band gains.
Those are faders side by side, low to high, because together they draw the curve they make, which a
row of knobs does not. A lone fader, on the other hand, costs three rows for what a 2×2 knob says,
on a card where every pixel counts, and reads as a mixer strip the module is not. The band rule is
CHECKED (`eqBandIssues`): a knob on a param named as a band is refused. A name like `Low Cut` or
`High Freq` is a frequency, not a band's gain, and stays a knob.

**Screens only where a picture says more than a knob.** The prompt names the cases: an envelope,
a filter curve, a waveform, a transfer curve, the level in against the level out. A screen that
prints numbers the knobs already show is clutter. A screen must also draw from params alone,
because in the builder there is no live plugin and its taps are empty (`ui-chains-react`'s
`lcdScreen.md`).

**A screen is interactive only when the author asks.** The prompt teaches the `{ draw, pointer }`
form, and says to use it only when the direction explicitly asks for a screen to drag, click or
edit. A screen that takes the pointer takes it from the graph too: a press on it no longer pans, a
wheel over one of its points no longer zooms, and a param moves under a hand that meant to move
the camera. That is right for an EQ curve somebody wanted to pull, and a trap on a screen nobody
knew was live. So it is CHECKED (`interactiveIssues`): a `pointer` in `widgets.js` is refused
unless the direction asks for interaction in words (`asksForInteraction`, English or French), or
the request is an UPDATE whose current script already had one. A word list is a coarse reading of
intent, and it errs on the side of drawing only: a refusal costs one repair round, where a screen
that steals the pointer costs the author a surprise.

**Two shapes, both checked.** The panel answered is the HORIZONTAL layout, at most 4 rows, and a
panel wider than 4 columns also carries its `vertical` twin, at most 4 columns
(`docs/layouts.md`). A model asked for one shape and left to derive the other gets the second wrong
in ways a reader would not spot — a knob missing on a phone — so `checkAiResult` holds the answer
to `twinIssues`: the sizes, the twin's geometry, and the same controls on every page of both.

## The answer is checked, twice, against the loader's own rules

The model answers JSON (`AI_RESULT_SCHEMA`, enforced by structured outputs) and `checkAiResult`
refuses what would break the module:

- the schema's own refusals, with their paths, since `UiFileSchema` is what the loader runs;
- a widget outside the grid, or two on top of each other — a `group` excepted, which frames what
  lies wholly inside it, so a widget straddling a group's edge is refused (`packages/panel-rules/src/groupGeometry.ts`,
  the rule the grid editor applies too); a page is checked **together with the
  panel-level widgets**, because those are drawn over every page;
- an id used twice anywhere in the panel;
- a `bind` that is not one of the parameters sent: a panel bound to an invented name loads fine
  and does nothing, which no other check would catch;
- on a RACK module, a tap that is not one of its sounds. `bindableNames` adds `@rack:<symbol>` for
  each sound the module's own `rack:` declares, and `@rack+` for the tap that adds one; the prompt
  lists them. A rack bind is accepted on a `tap` only and a tap must carry one, since either alone
  draws a card that plays nothing. Without this, the check would refuse every tap, and a kit's
  panel would come back without its pads;
- a crossfade knob whose `pair` is not one of the parameters sent, for the reason a bind is checked;
- the plugin's own mix, dry or wet on the panel where `@mix` is offered (`blendIssues`), or, where
  it is not, a dry and a wet level set by two widgets (`crossfadeIssues`);
- a group framing fewer than two widgets, on the panel or on a page (`loneGroupIssues`). A group is
  a SECTION; one around a single knob is a tint that says nothing a bare knob does not, and it costs
  the card a frame;
- a knob, slider, fader or number on an `@` param (`atControlIssues`), and the plugin's own
  input/output level where the engine offers the level (`levelIssues`) — the stage's;
- an lcdscreen with no draw function, and a `widgets.js` that does not compile. It is compiled
  with `new Function` and never called, so nothing the model wrote runs on the server;
- an interactive screen the author did not ask for (`interactiveIssues`, above).

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
