# The builder screen

`src/ModuleBuilder.tsx` is the full-screen module editor: a file's text on the LEFT, a visual grid
of the module's widgets on the RIGHT. This page holds the reasoning behind its shape, so the
component can carry one line per decision.

## Four files, four autosaves

A module is **four documents on disk with four schemas** — `module.yaml` (what it is), `ui.yaml`
(how it is drawn), `presets.yaml` (its named settings) and, for a `plugin: {type: jsdsp}` module
only, its own DSP source.

They get four autosaves rather than one save that walks them in order, and the whole point of the
rule is that a file is written when IT is readable: a half-typed widget in the panel must not stop
the module file being saved, which is exactly what a single button writing them in sequence did.
Each holds its own text back and says so on its own tab.

**Save writes all four**, not the pane on screen. A module
is four files describing one thing, and saving the one you happen to be looking at leaves the other
three behind, which on a shared module means publishing a panel for a plugin nobody else has yet.
They are edited together, so they land together. `publish` runs only if every one landed: `flush`
answers that, and a file held back because it would not compile reports false, so committing a
module whose `module.yaml` is still yesterday's cannot put a half-edit in front of everybody.

The parameters pane is the one pane with no CodeMirror in it, so it wires Ctrl+S itself — otherwise
the documented rule ("Ctrl+S and `:w` mean the Save button, and they save all four files") would
quietly have an exception.

**Dirtiness is derived, never a flag.** What is on disk is kept as one string per file and every
"dirty" comes from comparing it with the buffer: four flags and four buffers is four chances for
the screen to disagree with the disk, and autosave writes far too often for that. One badge covers
all four — the loudest thing any of them has to say — because which file it is about is already on
its tab.

The autosave hook is disabled by `enabled` rather than by a null path, so it still knows which file
it is about: a read-only pane then reports "clean" about the file it is showing instead of about
nothing.

### Only the module file can be redirected

st0 copies a shared module into the project rather than writing into the library, so the module
file's save may land elsewhere; the host is told and reopens. Following the new path from here
would leave the engine link and the title pointing at the module that was *not* edited. A sidecar
saves in place wherever it is, shared library included — nothing redirects it.

The panel and the shelf are both fetched separately and both allowed to fail: a file that is not a
module (a base being edited by path, say) still opens for its text, and the grid is simply
disabled. The DSP source is its own effect rather than a fourth call in the same one, because the
language is read off the BUFFER — so the tab lands the moment someone types the type, and an
ordinary module never asks a host for a file that is not there.

`module.yaml`'s `plugin.type` is read with a **regex and not the YAML parser**. This runs on every
keystroke in the code pane and the answer decides whether a tab is drawn; mid-edit the document
routinely does not parse, and a tab that blinked out on a half-typed line would be worse than one
read a shade loosely.

## Read-only is the same screen with the writing off

Showing a module without editing it — the state a SHARED module opens in — is not a lesser builder.
The params list, the live plugin and the preview all work; it is the same screen with the writing
turned off, which is what makes "you are about to change something everyone uses" a decision
somebody takes rather than a thing that happens while they look around.

The unlock button is drawn only when there IS one: a host that never unlocks passes nothing and
gets a plainly read-only screen. The host answers by flipping `readOnly`, and whatever it wants to
say first (a warning, a confirmation) is its own — a shared package knows this module is not the
project's, and cannot know whose it is or what writing to it costs.

The **shelf** is empty while the screen is read-only, since every one of its entries is an edit;
the plugin's own banks stay, because those load into the plugin. Applying a shelf preset stamps
values into the module BUFFER and is an edit and nothing more — no state to push, no engine to ask
— so trying four presets in a row writes four times, Ctrl+Z takes each one back and st0's journal
has them all. With no Save button to withhold, there is nothing else to undo them with. Stamping
values into a buffer nothing will write is how you lose an afternoon, which is why the read-only
guard is on the shelf and not on the factory presets.

## What is a prop, and why

Everything file-shaped goes through the injected `ModuleStore` (`store.md`). Four other things are
props because they are questions only a MACHINE can answer, over a socket:

- **`pluginParamNames` / `pluginParamRanges`** — the live params of the plugin loaded on this
  module's chain, and what each spans, so a bound widget adopts the real range instead of the
  placeholder 0..1.
- **`inputGroups` / the regroup call** — the interface's inputs as the engine GROUPS them, for an
  `io: in` module's channel picker. Which sets exist is known only to the machine holding the sound
  card. Absent, the picker offers only the grouping that already exists: the médiathèque draws this
  builder with no engine link, and an option that quietly did nothing would be worse than none.
- **the `extends` refs** — which plugins a machine has scanned. st0's backend reads the same cache
  off disk and puts it in `hints`; the médiathèque's has no such disk.
- **`renderPreview`** — the module drawn as the graph node it will be in a chain. This component
  owns the box and its height; the host owns what goes in it, because the graph renderer needs the
  app's own icons and command line and a shared package cannot invent either
  (`packages/ui-chains-react/docs/hosting.md`). Absent, the grid keeps the whole column.

**Optional means the button is not drawn, rather than drawn and dead.** That is the rule for
`onScanParams`, `onOpenNativeUi`, the regroup call and the base snapshot alike.

### Scanning, and opening the plugin's own window

`onScanParams` asks the MACHINE what this module's plugin has, by loading one on purpose. The live
list is what the OPEN PROJECT happens to have instantiated, which is the right default and leaves
one hole: a module the project does not wire has no live plugin, so an external one shows nothing
to bind to. This is the way out of that hole — not a second source of truth, but the same one asked
deliberately instead of opportunistically.

It is SLOW and the caller has to say so: it loads a plugin binary, which is seconds. It resolves to
what the plugin published, and `null` when this machine cannot find or LOAD it — different answers,
because the second is a licence or an installation and the first is not. The result is kept for as
long as the builder is open and **never persisted**: it is a fact about a binary on one machine,
and writing it into the module file would record somebody else's plugin version as if it were part
of the module. The NOTE matters as much as the names, because two of the three answers produce no
rows and without a sentence they are indistinguishable from a button that did nothing at all.

The plugin to ask about is what the module EXTENDS, and only an `@engine/…` ref names one a machine
can load — a jsdsp module or a rack has no binary behind it, and a `@st0/…` ref names another
module. `onOpenNativeUi` takes a NARROWER base than the scan does: `scanBase` is any `@engine/…`
ref and Tracktion's own built-ins are addressed that way too, but they wrap no `AudioProcessor` and
draw nothing, so offering the button on one would be a control that can only fail.
`builtinPluginForRef` is the same table that answers their parameters without an engine, so what is
left after it is exactly what this machine SCANNED: a VST.

Opening resolves when an engine has TAKEN the request, not when a window is on screen — the window
draws on the engine's machine, which may not be this one, and it rejects only when nobody took it.
The warning that this window's state is not saved with the project is printed **once the engine has
said it drew one** — printed on the request going out, it would report an open window while nothing
had happened — and **every time**, not once: the window is the plugin's own and looks exactly
like the one that DOES save in a project, so "this one does not" is the thing a user has to be
told. When something fails, the message is the HOST's — the interesting failure is "no window open
yet", and only the side that asked the engine knows that is what happened.

**Snapshotting a base** writes what is in that window as a named base, on the same `nativeUiBase`
because it is the same instance: the one the window opened, and the only one whose state anybody
dialled. A base is the blob for plugins whose sound is NOT in their parameters, which is why the
shelf (`presets.yaml`, named numbers) cannot stand in for it — on those plugins a saved shelf entry
is the factory default with a name on it. The path is the host's to work out; this passes back the
one it was given and the ref it read out of the module's own text. The list of bases is re-asked
after a snapshot, since that is the one thing on this screen that adds to it: a base you have just
made and cannot then bind would read as a save that did not happen. A snapshot is a WRITE into the
module's folder, so it follows the same lock the text does.

## The parameter list

`params` is the odd entry in the left column's strip and deliberately so: every other entry is a
FILE on disk, this one is the module's parameter list. It is in the strip because standing on its
own it takes a third of the column's height at all times, on every tab, for a list you reach for
while binding and ignore the rest of the time. The cost is that the text and the parameters are
not on screen together. It is a PANE, so it fills the column rather than taking a fixed third of
it, with no top border — there is nothing above it to be separated from.

The list is **read-only on purpose**: a value is edited in the text or by the plugin, never in two
places. It is filtered, because a real plugin has dozens and a list you can only scroll is one you
do not read. A long float is noise in a ~90 px row, so the untruncated value stays in the tooltip.
Dragging a row onto a widget is what binds it (`src/paramDrag.ts`), and the range rides along with
the name.

Every addressable param is unioned from **five sources**, none complete on its own, and they are
ranked most specific first:

1. the LOADED plugin's live report — it came from the instance this module actually is;
2. a deliberate SCAN of that same plugin — the same binary asked in the abstract, so it ranks under
   the live report and over anything written down;
3. what this module's own file declares as a built-in;
4. the base's declared built-in;
5. the io table.

Track intrinsics belong in it too: this list is the only place a binding can be picked up from.
The io binds bring their OWN ranges, there being no plugin to have reported any, and so does
`@base`, whose "range" is a list of names. The declared built-in's range is the only one a module in
a LIBRARY has: nothing there is instantiated, so no live report will ever arrive to fill it in.

An io module's own settings are offered **only on an io module** — on a plugin they would name
nothing. What KIND of module this is (an input, an output, an ordinary plugin) decides both what the
params list can offer and whether there is a socket to point the module at, and the PATH goes into
that decision: a module under `io/IN/` states nothing about itself and is still an input. The
authored value of an io setting lives at the file's TOP level (`gain: 6`) rather than under
`params:`, so `readParams` cannot see it and the row would read "—" on a module that plainly sets
one.

The io binds exist because an `io: in` module runs no plugin — the input IS the module — so without
them its panel had nothing to put on it. They are namespaced like the track intrinsics and for the
same reason: `gain` is a name plugins use constantly, and a bare one would be ambiguous the day an
input sat beside one. The trim's ±24 dB is the range an input trim is asked for, from a quiet guitar
to a hot line; Tracktion does not clamp this one, so the bound is a judgement about what is useful
rather than about what would be ignored. Monitoring is a DROPDOWN and not a toggle, because it is
three-state and "auto" — audible once armed — is the default and is neither on nor off; a toggle
would have hidden the value the input actually has.

`@base` is offered only on a module that HAS bases, which is what makes it a row rather than a
permanent one nearly every module would show empty. Its `states` are the names, so a widget bound to
it draws as a dropdown rather than a knob; the VALUES are positions and nothing more, and the graph
fills the real entries at draw time (`withBaseOptions`). It has to: a base can be snapshotted after
this panel is written, and a `ui.yaml` carrying the list would be a copy of a directory going stale.

The preview's widgets take the same values as NUMBERS. The pane keeps them as text because a value
is whatever the file says; a knob needs a position, so anything that is not a number is left out and
the widget falls back to its own min.

## Reading and writing the files (`src/moduleUi.ts`)

Every read here goes through the YAML **Document API** and every write is key by key, so the
comments and the key order of a file somebody hand-wrote survive it. The one exception is the
`ui:` block inside a module file, which is REPLACED — comments inside it do not survive.

**Parse through `toJS`, not `getIn`.** `getIn` hands back the NODE, and a `YAMLMap` has none of
the properties a Zod schema looks for: every field reads as undefined and a perfectly good block
is reported malformed.

**"Malformed" means present and unreadable.** Absence is not malformed — the grid can create a
block from scratch — and a file that does not parse AT ALL is the code editor's news, not this
one's. Same rule for `ui.yaml` and for `presets.yaml`: a shelf the schema refuses reads as EMPTY,
so one bad shelf costs its presets and never the module.

**`params:` is read as TEXT, not numbers.** The params pane only displays them, and a value the
schema would refuse should still be readable — showing what is actually in the file is the point.
A missing or unreadable `params:` is an empty map, never an error.

**A widget is written as MINIMAL source**: defaults and empty optionals are dropped, so the block
stays as terse as a hand-written one, and `undefined` entries are pruned recursively because they
mean "not written" rather than "written null". Each widget goes on ONE flow line
(`w1: { type: knob, col: 0, row: 0 }`) — the shape these files already have by hand, and what keeps
moving a knob to a one-line diff. A `tabs` is the exception: its pages are a nested structure worth
reading down the page.

**Range fields belong to the NUMERIC kinds only.** A `min` on a toggle fails to load and takes the
graph node with it, so the test names the numeric kinds: a "not label/tabs/waveform" test holds
only until a knob is retyped into one of those. A dropdown's `options` are written out in full,
because the module must draw the same
with no engine to re-fetch them, and its `library` is written alongside when both are set: the file
says what the author put.

**`ui.yaml` gets its own functions rather than a path parameter**, because the two shapes differ at
the root — `cols`/`rows`/`widgets` at the TOP level, with nothing naming the module, since the
folder it sits in does that — and you cannot `setIn([])` a document. It is rewritten key by key
because its header comment names the module the panel was drawn for, and a whole-document write
would drop it along with anything else in the margins.

**`KNOB_SPAN` is 2×2 in an AUTO-ORGANISED panel only.** A knob added from the palette or made by
dropping a parameter stays one cell: those are single, deliberate gestures onto a grid whose shape
the author already has in mind, and resizing one is a drag. `autoOrganize` places a hundred and
fifty at once onto a grid it sizes itself, and a wall of one-cell dials is a panel nobody can read
— so the proposal is the one that gets an opinion about how big a knob should be. It lives in
`moduleUi.ts` rather than `autoLayout.ts` because it is a fact about the WIDGET, not about the
guessing.

### `plugin:` is read shallowly, and `io:` from three sources

`readPlugin` reads the FILE rather than resolving through the project, which is the whole point: a
module in the libraries repository is not a base of the open song, so nothing in `paramsByBase`
describes it and the builder had no way to learn what plugin it is. The file says so in two words.
It is shallow on purpose — a module that only `extends` another states no plugin, and inheriting
one would mean resolving a ref this component cannot resolve. That case still has the two learned
sources and the live engine's report; this is for the one they all miss.

`ioOf` needs three sources, because a module rarely SAYS it: a real song's `ge_rythm-in.yaml` is
two lines, `extends: "@engine/IN"` and `channel: [ 2 ]`. Reading only the file's own key called that
a plugin, which cost it both its io binds and its channel picker.

1. its own `io:` — a file that states it is right about itself;
2. `extends: "@engine/IN"` — the engine's io modules are a fixed table, not files (`IO_MODULES`);
3. failing both, the PATH: a file under `io/IN/` is one of that folder's inputs. Location is how
   the loader decides this too — `in-2.yaml` beside `module.yaml` carries a channel and nothing
   else. The path is matched on the two-segment shape rather than borrowing `moduleKeyFromPath`,
   which would drag in caring where the workspace root is.

`channelOf` returns two spellings that are **not the same question**. A list of numbers is the
rig's channels directly (`[1]` mono, `[1, 2]` stereo). A STRING is a label from the machine's
preferences, resolved to numbers by whoever has them (`@studio/song`'s `resolveInput`) — a rig's
own naming, which this editor must not silently rewrite into numbers. Null when the module declares
none, which is an ordinary state: an input nobody has pointed at a socket yet.

`setChannelIn` writes a FLOW sequence (`channel: [1, 2]`), which is how every input in this repo is
written and how the docs show it — a two-element block list costs three lines to say one thing.
`flow` is set on the NODE rather than at stringify time, because only that sequence should be
inline and a document-wide setting would reflow every other list in the file.

`statusOf` reads the TEXT like everything else here, so the dropdown shows an unsaved edit.
`setStatusIn` never writes the default: a module with nothing to say about this should stay a file
that says nothing (the rule `type:` follows), and a `status: listed` on every module in a library is
a line of noise per file a reader has to learn to skip.

## Smaller decisions worth not rediscovering

- **`BuilderPane` is named for the BUILDER**, not just `Pane`: st0 has panes of its own and a
  shared package must not squat the word.
- **`status:` is read off the BUFFER**, not off the disk — the dropdown has to show the edit you
  just made, saved or not, exactly as the text pane does. It is the one field on this screen that
  changes nothing about the sound, and it sits in the HEADER rather than down in the text because
  it is a decision about the module as a catalogue entry — the same altitude as its name and its
  path beside it. Read-only, it is drawn as plain text and not as a disabled dropdown: a disabled
  control invites a click that will be refused, while what a locked module's status IS stays worth
  reading. It is named for the module, because
  `setStatus` here is the host's status LINE and two things called status is one too many. What
  each value is CALLED on screen differs from the file's word: `favorite` is drawn "first", because
  what the setting does is put the module at the top of the completions and a person choosing wants
  to read the effect rather than the sentiment. The FILE keeps the three schema words — this is a
  label, not a second spelling. See `packages/song/docs/moduleStatus.md`.
- **One table maps a plugin type to its DSP source filename**, because the tab, the fetch and the
  stub the host writes all have to agree on it. The names come from `@studio/engine-protocol`,
  where the compiler already reads them — a lookup, not a second spelling.
- **The PANEL opens first** in the code pane: it is what the grid beside it edits, and what people
  come to this screen for. A host that knows which of the files was clicked says so, and the click
  lands where it pointed. Which of the three sidecars the pane is on is computed as ONE expression,
  because three places downstream ask the same question and answering it three times is how they
  drift.
- **The header says nothing when everything is clean.** Four files on disk is the ordinary state of
  this screen and does not need announcing; "pending" says nothing either, because the button being
  live already says it, in a place you can act on.
- **A missing file is a buffer, not an error** (`ModuleStore.read`) — the panel and the shelf may
  not exist yet, and the store answers with the path the file WOULD take and blank content, so the
  first save creates it through the ordinary write route. But an edit that could never be written
  and outlived this screen is given back rather than written to disk.
- **Hints are merged, not substituted**: a project's own base modules are real vocabulary too, and
  the store's list and the host's live-engine list answer for different halves of what `extends:`
  may name. Deduped, since a project that has already scanned holds some of the same refs.
- **The generated built-in table is the source that needs no project.** `paramsByBase` is keyed by a
  base ref of the OPEN song, and st0 passes `paramRef={null}` when it opens a module from the file
  tree — so a module in the libraries repository had nothing at all: not a base of this project, not
  instantiated, no engine behind the overlay. That is
  `_libraries/modules/instruments/4osc/module.yaml`, where a shared module is authored, which makes
  it the case that mattered most. There are TWO ways a file names a built-in, and the second is the
  one that file actually uses:

  ```yaml
  plugin: { type: internal, name: 4OSC }   # a module that declares the plugin
  extends: "@engine/4osc"                  # a module that is only a FACE for one
  ```

  The whole of that file is the second line, so reading only the first finds nothing and leaves the
  list empty however complete the table is.
- **The DSP tab is drawn only for a module that HAS source.** A tab always there and usually dead
  would say every module could have DSP source, which is the opposite of what the type means.
- **A shelf the schema refuses is SAID so**, not silently listed as empty: the dropdown above it
  would then be missing presets plainly in the file. It is the one state that shows on the tab
  rather than only in its tooltip. Everything the tab's name does not say — absent, unread — lives
  in the tooltip rather than the label, so the tab reads as the file it opens.
- **A tile's glyph and caption are `pointer-events-none`**, so every drag event over a tile targets
  the TILE. They are what a tile is made of and they fill it, so a parameter dragged onto a widget
  is nearly always over one of them — and without it each crossing fires `dragleave` on the tile,
  clears the highlight and lets the cursor fall back to "no", while bare grid keeps working because
  an empty cell has no children. A cell under a widget is
  covered by that widget, which is later in the DOM and therefore takes the drop; that is what
  keeps the two drop paths from overlapping.
- **The grid refuses a drag for three reasons that mean the same thing to IT and to nobody else**,
  so it is told which, and only the FAULT gets a warning. A shared module opens locked, and saying
  its panel would not parse was false for every module in a library; a missing `uiFile` is the fetch
  having failed, which is "this path has no panel", not "the panel is broken".
- **Auto organize proposes a panel from every param there is** — the same rows the Parameters pane
  offers for dragging, deliberately: a proposal built from a shorter list would leave parameters out
  with nothing saying which. Extra fields on a row (its value, whether it is bound) are the pane's
  business and the layout ignores them. The params that take a FILE rather than a number offer the
  module's own `assets/`, a fixed list and not a scan of the project: the choices belong to the
  module, so there is nothing project-wide to read.
- **Factory presets need a live plugin instance**, so they are asked for only when editing the
  module itself.
- **Nothing resolves a pick.** The builder opens the catalogue, which already carries the file and
  both refs. Resolving here from a module name through `hints.paths` cannot work: by construction
  that map holds only the project's OWN modules, so a shared one comes back "couldn't resolve".
