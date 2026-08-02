# The engine link, and the builder that needs it

The médiathèque is a hosted catalogue of files, and for two of its three families that is
all it has to be: a morceau and a sample are bytes, and listing them needs nothing but a
directory walk. A **module** is different. A module file names a plugin, and the only thing
in the repo that knows what that plugin's parameters are called, what they span, and what
presets it ships is a running `apps/moteur`. No table can substitute — the answer belongs
to the loaded binary, and it changes when the plugin is updated.

So the module builder needs an engine, and the engine is on *your* machine.

## One engine, on loopback, and no picker

`src/engine/useModuleEngine.ts` probes `127.0.0.1:8765` (`probeLocalEngine`) and connects
to whatever answers. Deliberately unlike lanes, which has a registry, an engine list and a
lease: lanes plays a *song*, which can reasonably be driven from another machine, whereas a
module preview must run where the module will be used. "Which of my engines" has no
question to answer here.

An absent engine is a **normal state**, not an error. The editor still edits text; the
parameter list is simply empty, and the footer says why. Launching the capot fills it in.

## The preview document

`src/engine/preview.ts` builds the smallest `ProjectDoc` that makes a plugin exist: one
track named after the module, one plugin, no clips. Three things it gets right, each of
which was a bug at some point:

* **`recordDir` stays `""`.** The engine reads that as "refuse to arm". A preview plays and
  never records, and a made-up path is a lie the engine would eventually write into.
* **The plugin is `role: "instrument"`.** An audio effect on a silent track is a plugin a
  host may not bother to instantiate — and an uninstantiated plugin reports no parameters,
  which looks exactly like a plugin that has none.
* **The wire form is not the authored form.** `plugin: {type: internal, name: 4OSC}` in a
  module file means "the built-in called 4OSC"; on the wire the engine wants `type: 4OSC`.
  `enginePlugin` (in `@studio/engine-protocol/build`) swaps them, and getting it wrong
  loads nothing at all. `preview.test.ts` pins both directions.

Reading the `plugin:` block is done with two regexes rather than a YAML parser — a preview
needs two scalars, and both spellings used in this repo (indented block, inline flow) are
covered. Unparseable yields `undefined`, never a throw: a module with no plugin is a real
thing (an io module) and shows an empty list.

## Why the builder is here at all

It used to be a screen inside lanes, editing the workspace's `_modules` in place through an
`editShared` flag on the file service's write route. That worked because a workspace's
`_modules` was, at the time, where modules lived.

It is not any more. Modules live in the médiathèque, which every project reads through the
`@mediatek` named root; a workspace's copy is a **read-only mirror**, and the escape hatch
is gone (see `packages/song/docs/moduleFork.md`). Only the library is editable, so only the
library can host a builder.

What moved: `ModuleEditorPage`, `WidgetGridEditor`, `moduleUi`. What did **not**, and why:

* `EditorPane` stayed in lanes. It carries a sequence tracker, waveform views and video
  readers because lanes edits a song's *material*; a module is a page of YAML.
  `src/YamlPane.tsx` is the small pane that replaces it here.
* `paramDrag.ts` and `yamlVocabulary.ts` are **copies**, not moves — lanes still uses its
  own (`fileDrop.ts` reads the drag MIME, `EditorPane` reads the vocabulary). Each copy
  carries a header saying so.
* **User presets** are gone rather than ported. In lanes they were parameters saved into
  the active *project*, and a library has no project. Here, "save the current parameters"
  is what Save already does — a module file **is** its parameters, so a second place to
  keep them would be a second truth. Factory presets, which come from the plugin, stay.
