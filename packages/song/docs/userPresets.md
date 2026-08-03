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

`presets.yaml`, like `ui.yaml`, is the module ITSELF and not one use of it — `instanceFiles`
skips both by name. Without that guard a module with a shelf came back carrying a phantom
instance called `presets`.

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
