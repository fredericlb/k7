# Presets live in a presets tree, not in the module

The engine already discovers a plugin's **factory** presets: its program list and the
`.vstpreset` files in the OS's VST3 folders. `@studio/song-edit/presets` is the other half — the
presets a person saves or hand-authors.

## Where one is kept

One FILE per preset, in a presets tree beside the modules rather than in a module's folder:

```
<workspace>/_presets/<ns>/<module path>/<name>.yaml      kept in the workspace
<library>/presets/<ns>/<module path>/<name>.yaml         kept in a library
```

Two coordinates, and they answer different questions. The **tree** is where the preset is KEPT —
its scope, `workspace` or a library's name — and so who sees it and which repository a save
commits to. The **path** is which module it is FOR: the ref the node extends, without its `@`
(`@st0/audio/reverb` → `st0/audio/reverb`). A workspace may keep presets for a library module, and
a library may keep presets for another library's module; neither has to own the module.

Why not in the module's folder: a library module is shared, and a preset is often one person's or
one band's. Writing it into the module would mean committing to the library for every sound
somebody keeps, and a workspace could not keep its own presets for a module it does not own. The
module folder holds what the module IS; a preset is a use of it.

`_presets/` sits beside `_modules/`, so it is the same `@workspace` level and travels with the
workspace's repository. `presets/` is a family of a library repository like `modules/` and
`chains/`. A `presets.yaml` left in a module folder is read by nothing; the name stays reserved so
it never loads as a node.

## The file

```yaml
# preset for @st0/audio/dynamics/compressor
engine: vari-mu
params:
  Intensty: 0.6
  Output Level: 0.8
```

One param per line, hand-written rather than through `stringify`, so changing one value is a
one-line diff. A key is quoted only when YAML needs it: plugin param names carry spaces, and
quoting every one would be noise.

**Numbers only.** A node's `params:` may hold a filename, but that is an asset, not a setting a
preset should silently move.

`engine:` is written only for a module with several engines, because a module with engines keeps
its knobs PER engine (`engines.md`): values taken on `vari-mu` mean nothing to `tracktion`.
Applying such a preset switches the node to that engine first; an engine the module no longer has
is reported and the values land on the current one.

## Keyed by the node's module

A preset belongs to the module a node `extends`, so every node of `@st0/instruments/synth` offers
the same list. A node that extends nothing, or `@meta`'s built-ins, has none: there is no module
for a preset to be for.

## Saving and loading — on the NODE

Every action is a `node preset` verb (`apply`, `save`, `update`), so the graph's dropdown and the
command bar are one behaviour. `GET /presets?node=` is the one route, a LISTING; it answers with
`{ref, presets: [{scope, name}], scopes}`. A preset is addressed by scope and name, never by path:
the service builds the path and refuses one that would leave the module's folder.

- **Save** snapshots what the node RESOLVES to — its own values over everything it inherits, on the
  engine that is on — so a preset reproduces the sound, not just the knobs this node happened to
  touch. A taken name is refused: overwriting is a decision.
- **Update** is that decision: it overwrites an existing preset with the node's current values.
- **Apply** writes the preset's values into the node's own file, on the attribute set that is on,
  in ONE write, and reaches the engine as a values-only diff unless it switched engines. Values the
  preset does not name stay as they are.

The dropdown shows which preset was last loaded on each node. That is the shell's SESSION state:
a node file says what its values are, not where they came from, and after a knob moves the two
would disagree anyway. It is what lets the header offer **Update**.

## Why there is no opaque blob among them

A preset is a name and a list of parameter values, full stop — one shape, one code path to apply
it, and a shelf you can read and edit by hand like everything else here. A `<name>.presets/`
folder holding either a params snapshot **or** an opaque `.vstpreset` would be two kinds of thing
under one word.

The cost is real and worth stating: a plugin whose state is not addressable parameters cannot
have several remembered states here. It keeps the `<name>.vstpreset` in its folder that the
loader reads as its default, and that is all.

A `.presets/` folder on disk is **not** migrated. Same clean break as a `_ui/` tree.

## …and what the cost is answered by: `base/`

That cost — "a plugin whose state is not addressable parameters cannot have several remembered
states" — covers most of the plugins anybody reaches for. It is measurable: loaded from a
`.vstpreset`, an Arturia Wurli V2 reports
the same 50 parameter values as an untouched one, and a Mini V3 the same 77. Their patch is
opaque chunk state. Written into a preset as numbers, an Arturia sound is the factory default
with a name on it — a preset that looks saved and is not.

So the blob has a place of its own, deliberately **not** among the presets:

```
modules/<type>/<name>/module.yaml    what it does
modules/<type>/<name>/ui.yaml        how it's drawn
modules/<type>/<name>/<name>.vstpreset   its default state, read by the loader
modules/<type>/<name>/base/          named blobs: whole states, kept
_presets/<ns>/<type>/<name>/*.yaml    named settings — numbers, outside the module
```

The two do not compete, and the difference is worth holding on to:

| | a preset | `base/` |
|---|---|---|
| what it holds | named numbers | an opaque Steinberg container |
| readable, diffable, hand-editable | yes | no |
| applying one | stamps values into the node's file | `base: <name>` on the module or node |
| what it is for | a plugin whose state IS its parameters | one whose state is not |

`base/` is its own folder rather than more files loose beside the module, because the loader
already reads `<name>.vstpreset` there as the single default; a second spelling in the same
directory would be two rules over one namespace.

## Choosing one — `base:`, and what it may not disturb

A module or a node names the base it starts from:

```yaml
extends: "@st0/instruments/wurli"
base: warm            # base/warm.vstpreset, here or in an ancestor's folder
params: { Volume: 0.7 }
```

**Per INSTANCE**, because a node has its own file: two nodes of one module can sit on two bases,
which is the only reason choosing is interesting. `@base` is an intrinsic like `@monitor` — a
FIELD, not a param — so the engine learns it by rebuilding the module, which is what loading a
different `.vstpreset` requires.

**The params still win, and that is the whole ordering.** `EditBuilder` loads the preset and then
calls `applyPluginParams` over it — "text params override the preset", in its own words.
So a base decides only what the module could not have said in text, and every value the module
DID author survives a change of base. Picking a different sound never silently moves a parameter
somebody set; it moves everything nobody could.

That is also why the two live side by side rather than one replacing the other. On an Arturia
synth the base carries the patch and `params:` carries the handful of values the song overrides —
a filter opened, a level trimmed — and those overrides follow you from base to base.

### Where the file is looked for

`presetFor` in `basePreset.ts`, in this order:

1. the `base:` that was CHOSEN, if that base exists — nearest folder first, so a local base
   shadows an inherited one of the same name;
2. the node's own `<node>.vstpreset` — a per-placement state;
3. the module's `<leaf>.vstpreset` — the folder's default.

A `base:` naming a file this machine does not have **falls back** to 2 and 3 rather than loading
nothing: a base that has not synced yet leaves the module on its default state, which is a module
still worth playing.

Inherited bases resolve through the whole `extends` chain (`withInheritedFiles` in
`moduleResolve.ts`). That is the normal shape, not an edge case: the bases are snapshotted onto
the SHARED module that names the plugin, and a song points at it through a thin local module whose
own folder holds none. Resolved against that folder alone, the pick would find nothing and the
merge would keep the parent's default — the panel saying `warm` while the engine plays something
else, which is the same failure that function stops for asset files.

### The dropdown

A module with bases offers `@base` in the builder's parameter list, so a widget can be bound to
it like any other. The ENTRIES are not written into `ui.yaml`: the graph fills them at draw time
from what the loader found (`withBaseOptions`), because a base can be snapshotted after the panel
was authored and a list copied into the panel would go stale between saves. Same reason a live
input's socket list is the machine's rather than the panel's.

`none` is always the first entry. A chosen base has to be undoable, and without it the only way
out of one is editing the file by hand.

## Writing one: from the plugin's own window

`base/<name>.vstpreset` comes from the module builder's **Snapshot a base**, which reads the
ORPHAN instance behind its "Native UI" button — the plugin loaded on the engine's offline edit,
in no project. Three consequences, all wanted:

- It works with **no project open**, and on a plugin the open project never loads. A module is
  authored against a plugin by name, which is exactly the case a preset cannot help with.
- What is kept is what somebody **dialled in by hand** in the plugin's own UI, and nothing else.
- Opening that window still saves nothing. Snapshotting is the one act that takes something out
  of it, which is why it is a separate button and never implied by opening one.

A snapshot with no window opened is **refused**, not silently filled with defaults: the engine
answers `ok:false`, the route says 409, and the builder tells you to open the plugin first. A
base that is quietly the factory sound is the one failure here nobody would catch — it is a real
file, with the name you chose, holding a sound you never made.
