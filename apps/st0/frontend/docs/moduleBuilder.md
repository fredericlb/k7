# The module builder, and why it needs a project

`@studio/ui-module-builder` is one component, and st0 — the app that opens a project — is its
only host. The reason there is only one is the reason this one works.

## A parameter list is a fact about a LOADED plugin

A module file names a plugin. What that plugin's parameters are called, what they span, and
what factory banks it ships are not in the file and cannot be — they belong to the binary, and
they change when it is updated. The only thing that can answer is a running `engine/st0-engine`
with that plugin **instantiated**.

A host with an engine but no project has to manufacture one — the smallest `ProjectDoc` that makes
a plugin exist, one track, one plugin, no clips, on a session that exists only to hold it. That
works, and it costs:

- a second document on the machine, on a session with no other purpose;
- an audition that can be heard nowhere else, over an input picked from a menu that has to meter
  twenty channels at 8 Hz to be usable;
- and a builder whose live values describe a plugin nobody is playing through.

st0 has the thing such a host is imitating. **The plugin the builder reads is the one the
open project instantiates**, which is also the one making the sound.

## How the builder finds it

When the overlay opens, st0 reads the compiled graph and looks for a chain step whose `module`
matches the folder the file is in:

```
modules/audio/reverb/module.yaml            →  module "reverb"
graph.yaml:  tracks: { banc: [ reverb ] }  →  the step, and its pluginId
```

A chain step names a **module folder** or a **node**, and the lookup matches either, since
`step.module` is one string.

A **shared** module — one opened from the Libraries tab — is named the other way, with its
namespace: `@st0/audio/delay/tape-delay`, because that is what a chain writes for a module
the project inherits rather than holds. Same lookup, one spelling apart; see
[sharedModules.md](sharedModules.md).

Found: the builder gets the plugin's parameter names, their ranges, its factory presets, and
knobs that move the real thing (the params store and the setter go in **together** — a knob
that moves without changing anything is worse than one that does not move). The subscription is
paired with the overlay, so closing it stops the feed.

Not found: the text, the grid, the module's own preset shelf — and, through the built-in table
below, **still a parameter list for a built-in**. That is an ordinary state and not an error.

## …except for a built-in, which is knowable without any of that

The case that matters most is the one the section above cannot answer.

A module in a LIBRARY — `_libraries/st0/modules/instruments/4osc/module.yaml`, which
is where a shared module is authored — is not a base of the open song, is not instantiated by it,
and the builder overlay holds no engine link. st0 passes `paramRef={null}` when it opens a module
from the file tree, so `paramsByBase` is not consulted either. Every source above is empty, and
the bind dropdown with them: 4OSC, 68 parameters, none of them offerable.

The fourth source needs no project at all: the file names its plugin, and `@studio/song` says what
that plugin has, out of a table **generated from a real instance of every built-in the engine can
create** (`engine/st0-engine/docs/builtinParams.md`). Names and ranges both, which matters — a widget
bound with no range is drawn 0..1, and on a `-36..+36` semitone knob that is not cosmetic: it
writes the wrong number into the file.

**Two ways a file names one, and the second is the one a library module uses:**

```yaml
plugin: { type: internal, name: 4OSC }   # a module that DECLARES the plugin
extends: "@engine/4osc"                  # a module that is only a FACE for one
```

The whole of `_libraries/st0/modules/instruments/4osc/module.yaml` is that second line, plus two
comments. **Both** forms have to be read: the table on its own answers nothing for a file that
only ever names its plugin through `extends:`.

`@engine/<slug>` is `slugifyPluginName(displayName)`, the one rule `engineModuleOf` applies on the
machine and `baseModuleRefs` applies in a browser; `builtinPluginForRef` calls it rather than
restating it. Only the engine namespace resolves this way — a `@st0/…` or a project-local ref
names a FILE, which has to be read, and this seam exists for the case where there is nothing to
read.

An EXTERNAL plugin is unaffected either way: its parameters are its own and only a loaded instance
can list them.

Order, when several answer: the **loaded plugin** first (it is the instance this module actually
is), then what the module declares, then the base's, then the io table.

**The rule this puts on a chain.** Wire the module you want to work on, by the name a chain
gives it. For a shared module that is usually already true: you are editing it because this
song uses it. See [sharedModules.md](sharedModules.md).

## The grid greys out for three reasons, and only one is a fault

`WidgetGridEditor` takes a REASON, not a boolean: `"unparsable"`, `"locked"`, or false.

A boolean makes one note speak for both halves — so **every module in a library announces that
its panel will not parse**, about files that parse perfectly. A shared module opens
read-only by design; that is how you arrive at one, not something wrong with it. The third case
is a path with no panel at all, which the store answers by failing, and that is not a fault
either.

Only `"unparsable"` gets the amber note, because only that one has something to fix and a way to
fix it. Locked says so in the header, beside the button that unlocks it.

## Read-only, and the one host that uses it

The builder takes `readOnly` and `onRequestEdit`. Both exist for shared modules: one shows the
whole screen without arming a single autosave, the other draws the button that asks to be let
in. What the button *says* is the host's — a shared package knows this module is not the
project's, and cannot know whose it is or what writing to it costs. Same argument as
`renderPreview`. See [sharedModules.md](sharedModules.md).

## A file-valued param is a param, and all three arguments are QUOTED

Picking a file in the builder's asset browser writes `node param <node> <param> <file>`, not a
verb of its own. One verb per param, built from the param's own name (`module nam …`), means
choosing an `.onnx` sends a command nobody has written.

All three arguments are quoted, and the FILENAME is the one that matters. A `.nam` routinely
carries spaces and a subfolder: `two rocks/Two-Rock_Studio Overdrive_SM7b_All Flat_Clean.nam`.
Unquoted, the dispatcher's splitter folds most of that path into the PARAM name — which may
legitimately contain spaces, `Wet Level` — and takes the last token as the value, so picking an amp
refuses with `"Flat_Clean.nam" is not a number`, naming the tail of the file it just cut. The node
ref needs the same quoting for the same reason: *a node ref carries a `:` and may carry spaces, and
`node param` splits on them*. A filename does too, and more often.

The sentinel stays BARE: `none` is a word the command understands, not a file.

## What the builder deliberately has not got

- **An audition input picker.** A live input belongs to a TRACK
  (`inputChannels` / `monitor` on a `TrackDoc`), which the compiler wires from the project's own
  YAML — two lines in the lane's node file — and it feeds whatever you have chained after it,
  not one module in isolation.
- **A manufactured project.** Nothing here builds a `ProjectDoc` to make a plugin exist.
- **A metering menu.** `io-levels` exists and the engine only enables the devices it is asked to
  meter; nothing in st0 asks yet.

## What to check in a browser

The suites here mount nothing, so none of this is covered by a green run:

- wire a module into a chain, open the builder on it → its parameter list is the plugin's, and
  its factory presets are populated;
- drag one of those parameters onto a widget → the widget adopts the plugin's real range;
- turn a knob in the builder's card → the value moves in the graph too, and the sound changes;
- open the builder on a module the project does NOT instantiate, declaring an EXTERNAL plugin →
  an empty parameter list, and everything else still editable;
- open `_libraries/st0/modules/instruments/4osc/module.yaml` from the Libraries tab, with no project
  using it and no engine → the bind dropdown lists 4OSC's parameters, `Tune 1` offers -36..+36,
  and dragging one onto a knob gives it that range rather than 0..1;
- close the builder, then watch the engine log → no subscription left behind.
