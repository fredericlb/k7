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

A chain step names a **module folder** or an **instance**, and the lookup matches either, since
`step.module` is one string. On the bench it is always the folder: the catalogue is mirrored
into `modules/`, so every module in it is a `@project` module — and an instance may not take a
module's name, which settles the question by making the alternative illegal.

Found: the builder gets the plugin's parameter names, their ranges, its factory presets, and
knobs that move the real thing (the params store and the setter go in **together** — a knob
that moves without changing anything is worse than one that does not move). The subscription is
paired with the overlay, so closing it stops the feed.

Not found: the builder is exactly what it has always been here — the text, the grid and the
module's own preset shelf. That is an ordinary state and not an error. Every binding is typed
rather than picked, which is what editing a module the project does not use has always been.

**The rule this puts on a chain.** Wire the module you want to work on, by its folder name. That
is the bench's whole workflow rather than a quirk of this lookup — see
[apps/st0/docs/banc.md](../../st0/docs/banc.md).

## What did not move, and is not coming back

- **The audition's own input picker.** A live input belongs to a TRACK now
  (`inputChannels` / `monitor` on a `TrackDoc`), which the compiler wires from the project's own
  YAML. On the bench that is two lines in `tracks/banc.yaml`, and it feeds whatever you have
  chained after it — not one module in isolation.
- **`modulePreviewDoc`.** Nothing manufactures a project any more.
- **The métering menu.** `io-levels` still exists and the engine still only enables the devices
  it is asked to meter; nothing in l8 asks yet.

## What to check in a browser

The suites here mount nothing, so none of this is covered by a green run:

- open the bench, wire a module into the chain, open the builder on it → its parameter list is
  the plugin's, and its factory presets are populated;
- drag one of those parameters onto a widget → the widget adopts the plugin's real range;
- turn a knob in the builder's card → the value moves in the graph too, and the sound changes;
- open the builder on a module the project does NOT instantiate → an empty parameter list, and
  everything else still editable;
- close the builder, then watch the engine log → no subscription left behind.
