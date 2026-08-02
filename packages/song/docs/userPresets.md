# User presets live in the song

The engine already discovers a plugin's **factory** presets: its program list and the
`.vstpreset` files in the OS's VST3 folders. `presets.ts` is the other half — presets the
user saves or hand-authors, stored in the SONG so they travel with it.

They live in the module's own folder, keyed by its ref:

```
modules/<type>/<name>/<name>.presets/<preset>.yaml       a params snapshot
modules/<type>/<name>/<name>.presets/<preset>.vstpreset  an opaque Steinberg blob
```

A params snapshot suits built-ins and round-trippable plugins; anything else keeps its
opaque blob.

A `.presets` folder is a *directory*, not a module file, so `readModuleTree` and
`loadModules` — which read the module file of a folder — never descend into it.
