# graphDoc.ts — the plugin-state flags the Chains graph draws

A chain step carries three mutually-informing flags, so the graph can distinguish
"nothing here" from "something here that won't load".

## `stub`

A plugin slot with no plugin at all — typically a module that came in from an import
with nothing matched. NOT a rack, which legitimately carries a sampler instead of a
plugin.

## `notSupported` (amber)

The module HAS a plugin, and its `plugin.type` is the deliberate marker
`"not_supported"` — st0 knows about it and knows it can't load it.

## `unknownPlugin` (red)

The module HAS a plugin the engine can't load, for one of two reasons — both "unknown to
the engine":

- **an unknown `plugin.type`** — a typo, or a format the engine has no loader for;
- **a known EXTERNAL format whose plugin isn't in the scan cache**
  (`~/.studio/exts.json`) — e.g. a VST3 the project references but this machine hasn't
  scanned or installed. That's the common one on an imported song.

The KNOWN types are `internal`, `jsdsp`, `offline`, and the external formats. `jsdsp` had to be added
by hand once and was missed, which is worth remembering because of how it failed: the module
played perfectly — the compiler hands the engine its graph — while the node drew red and its
knobs drew empty. Empty because a red node gets no `pluginId`, and that is the address the
panel asks the engine for a parameter value by. So a missing entry in this list costs both
the colour and the values, and neither says which list is wrong.

## `offline` is known AND has no pluginId — the one case where they come apart

Being known and having an address are two different facts, and `offline` is the type that
proves it. It is known for the same reason `jsdsp` is — the compiler recognises it, so
drawing it red would call a module that works exactly as written broken. But where `jsdsp`
becomes a real plugin in the compiled document, `offline` becomes **nothing**: the compiler
reads the type and skips the emit (`if (rawType === OFFLINE_TYPE) continue`). It means "no
engine plugin, realised outside the graph" — a pass that writes files for a stem splitter,
the player warping the clip it feeds for m9's tempo.

So it gets no `pluginId`, and the reason is worth stating plainly: an id here would name an
address no document contains. It carried one for a while and everything downstream believed
it. m9's tempo faders were classed as plugin params and sent `set-plugin-param` to
`deckA:tempoA` for ever — no error, no log, a fader that moves and changes nothing. The
panel drew the same lie: a knob you could turn, over a param that was never there. And the
input tap two loops below, whose comment promises an id "the engine really has", could land
on one too.

Without the id the widget resolves to no target and goes inert — `pickWidget` returns on a
null target — which is the honest state. What such a module's panel shows is its DECLARED
params, since nothing live will ever arrive for them. Where the value actually lives is the
surface that realises it: for m9 that is the desk's fader, which addresses the TRACK.

## Why the two red cases behave differently downstream

An unknown FORMAT is unloadable anywhere, so `nodeProject` keeps it off the wire
entirely.

An UNSCANNED plugin is a per-MACHINE condition — the same project opens fine on the
machine that has it — so it still goes to the engine, which warns (`run 'st0 engine
scan'`) and skips it. The flag just says so up front, in the graph, instead of leaving
you to find out at playback.

Both carry no `ui` and no `pluginId`, and neither has a `hasNativePluginUI`: only a
plugin the engine can actually instantiate has a native editor window to open. That is
distinct from `ui`, which is the moduleUI widget grid st0 draws itself.
