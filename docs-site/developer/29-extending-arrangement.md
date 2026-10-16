# Extending: a new arrangement gesture or verb

The arrangement grows in a fixed order: **the write first, then the verb, then the gesture.** A
gesture with no verb under it would be a write the CLI cannot make, the journal cannot name and the
menu cannot offer.

## 1. The writer, in `@studio/song-edit`

Add (or extend) a function in `packages/song-edit/src/` that changes the value and nothing else:
read the file with `wsRead`, edit through the structured helpers of
`packages/song-schema/src/yaml/` (`trackFile.ts` for placements: `findPlacementAt`,
`setPlacementField`, `movePlacementAt`…), write with `wsWrite`. Address an event by its lane and its
start in beats. Quote timecodes. Delete a field rather than writing its default — a file that never
mentioned `gain` should not grow `gain: 0`.

Test it the house way, asserting the file differs by exactly the line you meant (see
`packages/song-edit/src/moveEvent.test.ts`). If it is a new module, add it to the package's
`exports`; packages are consumed as source through those subpaths, and a deep import fails on purpose.

## 2. The verb, in `@studio/commands`

1. **Declare it** in `packages/commands/commands.yaml`: the command string, a `sid`, `readable` in
   `en` and `fr` (imperative, no example, at most 60 characters — `commandSpec.test.ts` enforces
   it), a `help` line with an example, `surfaces: [cli]`, and `args` with `complete:` providers or
   `values:`, `type: timecode|number|note` for single-token arguments, and a `hint:` wherever a
   value's unit is ambiguous — say whether a timecode is a **position** or a **length**.
2. **Choose its right-click** with `menu:` only to narrow it. Without it, the menu is derived: any
   command whose leading arguments match what was clicked is offered (`contextMenu.ts`'s
   `fromCatalogue`). An `event …` verb whose first two arguments are `track` and `timecode` appears
   on every event's menu by itself. Add `confirm: true` for a verb that destroys more than Ctrl+Z is
   trusted with.
3. **Implement the handler** in `packages/commands/src/verbs/<topic>.ts`, exported as a
   `Record<string, SidHandler>` and listed in `VERB_TABLES` in `packages/commands/src/commands.ts`
   (as `CROSSFADE_VERBS` is). Parse, resolve against `h.project()`, `h.refuse([...])` with a sentence
   naming what is wrong before writing anything, call the writer, `h.log([...])`, `await h.reload()`.
   A verb that renders audio takes `rendererOf(h)` (`verbs/shared.ts`) and refuses when it is null.
4. **Test it** against `packages/commands/src/testHost.ts`.

If a gesture would need the verb N times, write the bulk verb instead (`events add`,
`sequence notes move`): one line, one journal entry, one reload, and no half-applied state.

## 3. The gesture, in the frontend

- **A key**: add the binding to `KEYS` in `apps/k7/frontend/src/keys.ts`, conditional on the state it
  needs (`{ if: "timeline_active", command: … }`) and interpolating the caret
  (`{caret_track}`). The help overlay and tooltips read the same table.
- **A tool**: add it to `TOOLS` in `apps/k7/frontend/src/timelineTools.ts`, give `toolLine` its case
  and a label in `apps/k7/frontend/messages/en.json` and `fr.json` (`tool.*`), and test the line it
  produces in `timelineTools.test.ts`.
- **A drag**: keep it in the component that owns the pointer, reported upward by a callback prop;
  `App.tsx` turns it into the line. Follow the existing drags: grab state with `pending`, snapping
  through `apps/k7/frontend/src/snap.ts`, nothing written when it ends where it started, the pointer
  followed with `usePointerFollow` so a cancel abandons cleanly.
- **A one-shot line that should show before the reload**: teach `pendingOf` in
  `apps/k7/frontend/src/pendingEdits.ts` what it does to the lanes, and test it.
- **A pre-filled form**: when the caret or rectangle can answer some of a verb's arguments, add the
  verb to `CARET_ANSWERS` in `apps/k7/frontend/src/commandFill.ts`. That list is explicit on
  purpose: a caret that pre-answered every destructive verb would make them one keystroke away.

A behaviour only a browser can have (it touches no file, or the data exists only in the page) is a
shell-local verb instead: add it to `LOCAL_COMMANDS` and `LOCAL_READABLE` in
`apps/k7/frontend/src/palette.ts` — `palette.test.ts` refuses a local command without a readable
sentence — route it in `runLocalCommand` in `App.tsx`, and put it under `ui` when it changes only the
view (`localCommands.ts` enforces the pairing both ways).

## Checklist

- [ ] The writer changes one line and is tested for it.
- [ ] The verb has `readable` in both languages, hints on its ambiguous arguments, refusals that say
      what to do.
- [ ] The gesture produces exactly that line and nothing else.
- [ ] `npm run lint` passes on every file touched; `npm run lint:docs` passes on every comment that
      names a file.

## See also

- [The edit path](./21-edit-path.md)
- [Testing the arrangement code](./28-arrangement-tests.md)
