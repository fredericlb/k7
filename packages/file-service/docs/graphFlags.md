# graphDoc.ts — the plugin-state flags the Chains graph draws

A chain step carries three mutually-informing flags, so the graph can distinguish
"nothing here" from "something here that won't load".

## `stub`

A plugin slot with no plugin at all — typically a module that came in from an import
with nothing matched. NOT a rack, which legitimately carries a sampler instead of a
plugin.

## `notSupported` (amber)

The module HAS a plugin, and its `plugin.type` is the deliberate marker
`"not_supported"` — l8 knows about it and knows it can't load it.

## `unknownPlugin` (red)

The module HAS a plugin the engine can't load, for one of two reasons — both "unknown to
the engine":

- **an unknown `plugin.type`** — a typo, or a format the engine has no loader for;
- **a known EXTERNAL format whose plugin isn't in the scan cache**
  (`~/.studio/exts.json`) — e.g. a VST3 the project references but this machine hasn't
  scanned or installed. That's the common one on an imported song.

The KNOWN types are `internal`, `jsdsp`, and the external formats. `jsdsp` had to be added
by hand once and was missed, which is worth remembering because of how it failed: the module
played perfectly — the compiler hands the engine its graph — while the node drew red and its
knobs drew empty. Empty because a red node gets no `pluginId`, and that is the address the
panel asks the engine for a parameter value by. So a missing entry in this list costs both
the colour and the values, and neither says which list is wrong.

## Why the two red cases behave differently downstream

An unknown FORMAT is unloadable anywhere, so `nodeProject` keeps it off the wire
entirely.

An UNSCANNED plugin is a per-MACHINE condition — the same project opens fine on the
machine that has it — so it still goes to the engine, which warns (`run 'l8 engine
scan'`) and skips it. The flag just says so up front, in the graph, instead of leaving
you to find out at playback.

Both carry no `ui` and no `pluginId`, and neither has a `hasNativePluginUI`: only a
plugin the engine can actually instantiate has a native editor window to open. That is
distinct from `ui`, which is the moduleUI widget grid l8 draws itself.
