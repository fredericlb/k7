# The engine link, and the builder that needs it

The médiathèque is a hosted catalogue of files, and for two of its three families that is
all it has to be: a morceau and a sample are bytes, and listing them needs nothing but a
directory walk. A **module** is different. A module file names a plugin, and the only thing
in the repo that knows what that plugin's parameters are called, what they span, and what
presets it ships is a running `apps/moteur`. No table can substitute — the answer belongs
to the loaded binary, and it changes when the plugin is updated.

So the module builder needs an engine, and the engine is on *your* machine.

## Which engine, and where the choice lives

It was loopback and nothing else once, on the argument that a preview must play on the
machine the module will be used from — so "which of my engines" had no question to answer.
That held while a person had one machine.

The médiathèque holds its own registry now (`packages/engine-registry/docs/shared.md`: each
hosted service keeps one, so an engine appears here only once its capot has been pointed at
the médiathèque). The choice is remembered **on the account**, and the policy lives in
`chooseEngine` where it can be tested. `useEngineChoice` reads the list and the remembered
id WITHOUT connecting — drawing a menu must not open a second socket to the engine
`useModuleEngine` is already holding.

## The Modules section is gated on one

An absent engine used to be a **normal state** everywhere: the editor still edited text, the
parameter list was simply empty, and the footer said why. That is still true *inside* the
builder — an engine can drop mid-edit and the text must not become unsavable — but it is no
longer true at the door.

`Library.tsx` puts an overlay over the Modules section until `useEngineChoice` reports one
chosen AND reachable from this browser. Not a nag: a module IS what a plugin is, so without
one the builder edits blind — every binding typed from memory, every range guessed, every
preset absent. Being told to pick an engine is a better answer than a screen that looks like
it works.

Two states it deliberately tells apart, because a bare "no engine" hides the second:

- nothing has announced itself — the capot has not been pointed at the médiathèque;
- something is remembered but does not answer, which means "turn that machine on".

`choice.loaded` is what keeps it from flashing in everybody's face on load: before it, "not
chosen" and "not looked yet" are the same value. The header stays above the overlay, so the
other two sections are one click away — the gate is on Modules, not on the app.

The picker's rows are `EngineList`, rendered bare here and inside the header's popover. One
list, two wrappers: a second rendering of the same choice is a second thing to keep in step.

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

## Why the builder passed through here

It used to be a screen inside pistes, editing the workspace's `_modules` in place through an
`editShared` flag on the file service's write route. That worked because a workspace's
`_modules` was, at the time, where modules lived.

It is not any more. Modules live in the médiathèque, which every project reads through the
`@mediatek` named root; a workspace's copy is a **read-only mirror**, and the general escape
hatch is gone (see `packages/song/docs/moduleFork.md`). So the builder moved here, where the
catalogue is editable.

**It is a package now** — `@studio/ui-module-builder` — and pistes draws the same component
again, over a store of its own. Moving it here was still the right step: it is where the
builder was rebuilt around the library's own service, and that rebuild is what made the seam
obvious enough to name. What this app keeps is the host around it: the engine link, the
entry it was opened on, and the vim toggle.

What did **not** move into the package, and why:

* `EditorPane` stayed in pistes. It carries a sequence tracker, waveform views and video
  readers because pistes edits a song's *material*; a module is a page of YAML.
  `YamlPane.tsx`, in the package, is the small pane that replaces it.
* `yamlVocabulary.ts` went further out still, to `@studio/ui-editor/yaml/vocabulary`: three
  editors need the same answers, and what completes where is a *language* concern, not a
  builder one. `paramDrag.ts` is the package's, exported, because a host's file tree has to
  recognise the drag to ignore it.
* **User presets** are gone rather than ported. In pistes they were parameters saved into
  the active *project*, and a library has no project. Here, "save the current parameters"
  is what Save already does — a module file **is** its parameters, so a second place to
  keep them would be a second truth. Factory presets, which come from the plugin, stay.
