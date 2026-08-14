# The module builder, and why it needs a project

`@studio/ui-module-builder` is one component and l8 is now its only host. It used to have two:
the médiathèque drew it as well, over its own engine link. That one is gone, and the reason is
worth writing down, because it is the same reason this one works.

## A parameter list is a fact about a LOADED plugin

A module file names a plugin. What that plugin's parameters are called, what they span, and
what factory banks it ships are not in the file and cannot be — they belong to the binary, and
they change when it is updated. The only thing that can answer is a running `engine/moteur`
with that plugin **instantiated**.

The médiathèque had an engine but no project, so it manufactured one: `modulePreviewDoc` built
the smallest `ProjectDoc` that makes a plugin exist — one track, one plugin, no clips — and
sent it down its own session. It worked, and it cost:

- a second document on the machine, on a session that existed only to hold it;
- an audition that could be heard nowhere else, over an input picked from a menu that had to
  meter twenty channels at 8 Hz to be usable;
- and a builder whose live values described a plugin nobody was playing through.

l8 has the thing the médiathèque was imitating. **The plugin the builder reads is the one the
open project instantiates**, which is also the one making the sound.

## How the builder finds it

When the overlay opens, l8 reads the compiled graph and looks for a chain step whose `module`
matches the folder the file is in:

```
modules/audio/reverb/module.yaml            →  module "reverb"
chains.yaml:  tracks: { banc: [ reverb ] }  →  the step, and its pluginId
```

A chain step names a **module folder** or a **node**, and the lookup matches either, since
`step.module` is one string.

A **shared** module — one opened from the Libraries tab — is named the other way, with its
namespace: `@mediatek/audio/delay/tape-delay`, because that is what a chain writes for a module
the project inherits rather than holds. Same lookup, one spelling apart; see
[sharedModules.md](sharedModules.md).

Found: the builder gets the plugin's parameter names, their ranges, its factory presets, and
knobs that move the real thing (the params store and the setter go in **together** — a knob
that moves without changing anything is worse than one that does not move). The subscription is
paired with the overlay, so closing it stops the feed.

Not found: the builder is exactly what it has always been here — the text, the grid and the
module's own preset shelf. That is an ordinary state and not an error. Every binding is typed
rather than picked, which is what editing a module the project does not use has always been.

**The rule this puts on a chain.** Wire the module you want to work on, by the name a chain
gives it. For a shared module that is usually already true — you are editing it because this
song uses it — which is what made the module bench unnecessary. See
[sharedModules.md](sharedModules.md).

## Read-only, and the one host that uses it

The builder takes `readOnly` and `onRequestEdit`. Both exist for shared modules: one shows the
whole screen without arming a single autosave, the other draws the button that asks to be let
in. What the button *says* is the host's — a shared package knows this module is not the
project's, and cannot know whose it is or what writing to it costs. Same argument as
`renderPreview`. See [sharedModules.md](sharedModules.md).

## What did not move, and is not coming back

- **The audition's own input picker.** A live input belongs to a TRACK now
  (`inputChannels` / `monitor` on a `TrackDoc`), which the compiler wires from the project's own
  YAML — two lines in the lane's node file — and it feeds whatever you have chained after it,
  not one module in isolation.
- **`modulePreviewDoc`.** Nothing manufactures a project any more.
- **The métering menu.** `io-levels` still exists and the engine still only enables the devices
  it is asked to meter; nothing in l8 asks yet.

## What to check in a browser

The suites here mount nothing, so none of this is covered by a green run:

- wire a module into a chain, open the builder on it → its parameter list is the plugin's, and
  its factory presets are populated;
- drag one of those parameters onto a widget → the widget adopts the plugin's real range;
- turn a knob in the builder's card → the value moves in the graph too, and the sound changes;
- open the builder on a module the project does NOT instantiate → an empty parameter list, and
  everything else still editable;
- close the builder, then watch the engine log → no subscription left behind.
