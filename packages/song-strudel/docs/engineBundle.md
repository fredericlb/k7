# What this package is for

The ENGINE plays every strudel lane (`engine/st0-engine/docs/patternPlugin.md`). What it runs of
Strudel is a single script, `engine/st0-engine/engine/strudel/strudel.bundle.js`, built from
`src/engineEntry.ts` by `npm run gen:strudel-bundle --workspace st0-engine` and committed. This
package is that script's SOURCE, and the place it is tested under Node before QuickJS ever sees it.
Nothing imports it at run time.

## Why it is still a package

The three `@strudel/*` packages are its dependencies and nobody else's: no screen, no service and
no compile pulls them in. Keeping them here is what keeps it that way.

## One rule set, stated once

`src/events.ts` is the hap → event mapping, the pitch an event plays at when it is a note, and
`labelKey`, the slug a `.label()` and a lane name are compared by. Whether an event is a SAMPLE is
not decided here: the engine holds the banks, so every event carries its `s` and `n` and the engine
tries the name as a sample first.

`src/engineEntry.test.ts` and the engine's `tests/StrudelHost_test.cpp` assert the same lane events
on the same pattern, one under Node and one under QuickJS. Changing what a lane receives means
changing both, and regenerating the bundle.

## Pinned at 1.1.x

1.2 and later pull in a browser-only synth (`@kabelsalat/web`) that does not load outside a browser,
under Node or QuickJS alike.
