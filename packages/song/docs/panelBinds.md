# Panel binds — `npm run lint:panels`

A panel control is bound to a param by NAME (`bind:` in a module's `ui.k7x`), and the engine applies
a value by finding that name in the plugin's parameter list (`applyPluginParams`). A name the plugin
does not have is dropped with a warning in the engine's log and nothing on screen: the control moves,
the value is saved in the song, and the sound does not change. `scripts/checkPanelBinds.ts` finds
every such control in a library.

**The list it checks against is the engine's own.** A built-in's parameters come from
`@studio/song-schema`'s generated `builtinParams` list, read out of real instances; an external is
instantiated by the engine binary's `--dump-params-ext`, which lists exactly the names
`applyPluginParams` matches — Tracktion's automatable parameters. A plugin's own window, its preset
browser or a vendor's manual may show more: a parameter the plugin does not mark automatable is not
in that list, so it cannot be set from a panel at all. That is the common case, not a corner:
Arturia's instruments keep switches, bypasses and room selectors out of it.

**It runs only where the plugins are.** An external has to be installed and scanned to be dumped,
so this is a check run on a machine with the library's plugins, never in CI; a panel whose plugin
cannot be built is reported as not checked rather than as clean. jsdsp, Faust and offline modules
are not checked either: their params are their own source's, and the builder already writes those.

**Names are compared exactly**, as the engine compares them. A bind that differs from an exposed
name only by case, spaces or punctuation is printed with the name it meant — a typo to fix in the
panel, unlike a name that is not there, which needs the control removed or the param reached some
other way (the plugin's window, its preset). File-valued params (`model`, `ir`) and the engine's own
`@`-names are not plugin parameters and are skipped.

It exits non-zero when it finds any, and is not part of `npm run lint`, which must pass on a machine
with no plugins installed.
