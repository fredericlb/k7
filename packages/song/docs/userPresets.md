# Presets live in the module's folder

The engine already discovers a plugin's **factory** presets: its program list and the
`.vstpreset` files in the OS's VST3 folders. `presets.ts` is the other half — the presets a
person saves or hand-authors, stored with the module so they travel with it.

They are one file, the third of the module's own three:

```
modules/<type>/<name>/module.yaml    what it does
modules/<type>/<name>/ui.yaml        how it's drawn
modules/<type>/<name>/presets.yaml   its named settings
```

## The file

A name, and the values it sets. Nothing else, because there is nothing else to record — the
folder says which module they belong to, exactly as it does for the panel.

```yaml
# presets for audio/reverb
hall: { Mix: 0.8, Size: 0.9, Damp: 0.3 }
plate: { Mix: 0.4, Size: 0.2, Damp: 0.7 }
```

One flow mapping per line, hand-written rather than through `stringify`, for the same reason
the panel writer does it: a preset is read as a *row*, and adding one should be a one-line
diff. A param name with a space needs no quotes as a YAML key, and quoting it anyway would
put noise in every line of every shelf — the names plugins use are almost all like that.

**Numbers only.** That is what a module's `params:` holds, so a preset that could not be
written there would be one that cannot be applied.

`presets.yaml`, like `ui.yaml`, is the module ITSELF and not one use of it — `nodeFiles`
skips both by name. Without that guard a module with a shelf came back carrying a phantom
node called `presets`.

## What was dropped, and why

It used to be a `<name>.presets/` folder with one file per preset, and a preset could be
either a params snapshot **or** an opaque `.vstpreset` blob for plugins whose state isn't
named values.

The blob is gone. A preset is a name and a list of parameter values, full stop — one shape,
one code path to apply it, and a shelf you can read and edit by hand like everything else
here. The cost is real and worth stating: a plugin whose state is not addressable
parameters can no longer have several remembered states. It keeps the `<name>.vstpreset`
in its folder that the loader reads as its default, and that is all.

Old `.presets/` folders are **not** migrated. Same clean break as the `_ui/` tree.

## …and what came back, under another name: `base/`

The paragraph above states a cost — "a plugin whose state is not addressable parameters can no
longer have several remembered states" — and that cost turned out to be most of the plugins
anybody reaches for. It is measurable: loaded from a `.vstpreset`, an Arturia Wurli V2 reports
the same 50 parameter values as an untouched one, and a Mini V3 the same 77. Their patch is
opaque chunk state. Written into `presets.yaml` as numbers, an Arturia sound is the factory
default with a name on it — a shelf entry that looks saved and is not.

So the blob is back, and deliberately **not** as a preset:

```
modules/<type>/<name>/module.yaml    what it does
modules/<type>/<name>/ui.yaml        how it's drawn
modules/<type>/<name>/presets.yaml   its named settings — numbers
modules/<type>/<name>/<name>.vstpreset   its default state, read by the loader
modules/<type>/<name>/base/          named blobs: whole states, kept
```

The two do not compete, and the difference is worth holding on to:

| | `presets.yaml` | `base/` |
|---|---|---|
| what it holds | named numbers | an opaque Steinberg container |
| readable, diffable, hand-editable | yes | no |
| applying one | stamps values into the module text, undone by not saving | `base: <name>` on the module or node |
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
calls `applyPluginParams` over it — "text params override the preset", which it has always said.
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
merge would keep the parent's default — the panel saying `warm` while the engine played something
else, which is the exact failure the same function already existed to stop for asset files.

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
  authored against a plugin by name, which is exactly the case `presets.yaml` cannot help with.
- What is kept is what somebody **dialled in by hand** in the plugin's own UI, and nothing else.
- Opening that window still saves nothing. Snapshotting is the one act that takes something out
  of it, which is why it is a separate button and never implied by opening one.

A snapshot with no window opened is **refused**, not silently filled with defaults: the engine
answers `ok:false`, the route says 409, and the builder tells you to open the plugin first. A
base that is quietly the factory sound is the one failure here nobody would catch — it is a real
file, with the name you chose, holding a sound you never made.

## Applying one

Two ways in, and they do the same thing to the same file:

- The **builder** stamps the values into the module buffer it is already editing
  (`applyPresetToText`). An edit and nothing more: no state to push, no engine to ask. It
  lands unsaved, so it is visible before it is committed and undone by not saving — which
  is what makes trying four presets in a row bearable.
- `POST /presets/apply` writes them through `setModuleParam` and reloads the project. **By
  name**, not by path: the shelf is a file in the module's folder, so there is no path in
  the body and nothing for a crafted one to escape.

Saving one (`saveModuleAsPreset`) snapshots the module's authored params under a new name,
refusing a name already taken — overwriting is a decision, not a side effect of saving.

## Which modules can hold them

The ones with a **folder**: a local plugin module. An io module has no parameters to name;
an inherited `@ns/…` one is read where it lives, and its shelf belongs to the library that
owns it, not to whoever plays it.

A module the engine merely reports has no folder at all — see `moduleFork.md`'s
`materialiseEngineModule`, which is how it gets one.
