# `controller.yaml` — a module's MIDI map

Which control change plays which of a module's params. One file, in the module's own folder,
beside `module.yaml`:

```yaml
# MIDI map for instruments/synth — <param>: { ch, cc }. Shared by every node of this module.
Filter Freq: { ch: 1, cc: 74 }
Resonance: { ch: 1, cc: 71 }
```

The key is the param exactly as a **widget binds it** (`ui.yaml`'s `bind:`), so the map and the
panel line up key for key and can be read side by side. `ch` is 1–16 as a musician counts them,
not 0–15 as the wire does — this file is read by people; the runtime subtracts the one.

## Why the module's folder

It is the fourth sibling of `module.yaml`, `ui.yaml` and `presets.yaml`, and it is there for the
same reason the panel is: **the folder says which module it belongs to, the file only says how it
is played.** A module is a device — the map is how your hands reach that device, and it should
follow it into every project that names it, exactly as its face and its presets do.

Two consequences fall out of that, and both are the location working rather than leaking:

- **Every node shares one map.** Two nodes of the same module in one song both answer to
  CC 74, because a node is one *setting* of a device and there is only one device. This is
  what the preset shelf already does (`presets.ts`), for the same reason.
- **It is not the song's.** Moving a song to another machine does not carry your controller
  layout unless the module travels too — and if the module came from the médiathèque, it does.

A map on a **lane's** mixer control is not expressible: a lane is a module (trackModules.md), but
a FLAT node has no folder to put a `controller.yaml` in. That is a real limit of this location,
and the graph declines to offer the menu there rather than writing somewhere the value could not
be read back from.

## One control per param, not one param per control

The key is the param, so a param has at most one control. Two controls fighting over one value is
a bug you cannot see, and binding again simply replaces.

The reverse is allowed: two params may name the same `ch`/`cc`, and both move together. That is a
macro, and it is a thing people want.

## Reading it

`loadControllerLibrary` walks every module library the project can see, nearest first — the same
walk the panels use (`moduleSiblings.ts`, shared so the two cannot disagree about which folders
exist). The loader then stamps the map onto every module that answers to the ref, beside its
panel, so the graph, the engine doc and the web all see it without knowing the library exists.

**A malformed map reads as no map**, with an issue reported. A typo in one binding must not stop
a module loading, exactly as a malformed panel does not — and `resolvedCc` validates again on the
way out, because a module read back from a cached doc has never been through the schema.

## Writing it

Through `module cc`, like every other edit:

```
module cc synth "Filter Freq" 1 74     # bind
module cc synth "Filter Freq" none     # unbind
```

`bindModuleCc` resolves the module a *chain* names to the folder its files live in, through
`moduleOwnRefs` — the same list the panel is looked up by, so a map always lands in the folder the
widgets came from. A node therefore writes to the module it is a use of.

A module the ENGINE merely reports has no folder at all; `module own` is what gives it one, and
the error says so rather than writing nowhere.

## The trap

`nodeFiles` treats every `<name>.yaml` in a module folder as a NODE of the module,
except the folder's own (`MODULE_OWN_BASES`). A sibling added without registering it there comes
back as a module called `synth:controller`. That is why the list is a named export and not four
string literals — and there is a test for exactly this, on every one of them.
