# graphDoc.ts — the plugin-state flags the Chains graph draws

A chain step carries three mutually-informing flags, so the graph can distinguish
"nothing here" from "something here that won't load".

## `stub`

A plugin slot with no plugin at all — typically a module that came in from an import
with nothing matched. NOT a rack, which legitimately carries a sampler instead of a
plugin.

## `notSupported` (amber)

The module HAS a plugin, and its `plugin.type` is the deliberate marker
`"not_supported"` — pistes knows about it and knows it can't load it.

## `unknownPlugin` (red)

The module HAS a plugin the engine can't load, for one of two reasons — both "unknown to
the engine":

- **an unknown `plugin.type`** — a typo, or a format the engine has no loader for;
- **a known EXTERNAL format whose plugin isn't in the scan cache**
  (`~/.studio/exts.json`) — e.g. a VST3 the project references but this machine hasn't
  scanned or installed. That's the common one on an imported song.

## Why the two red cases behave differently downstream

An unknown FORMAT is unloadable anywhere, so `nodeProject` keeps it off the wire
entirely.

An UNSCANNED plugin is a per-MACHINE condition — the same project opens fine on the
machine that has it — so it still goes to the engine, which warns (`run 'pistes engine
scan'`) and skips it. The flag just says so up front, in the graph, instead of leaving
you to find out at playback.

Both carry no `ui` and no `pluginId`, and neither has a `hasNativePluginUI`: only a
plugin the engine can actually instantiate has a native editor window to open. That is
distinct from `ui`, which is the moduleUI widget grid pistes draws itself.
