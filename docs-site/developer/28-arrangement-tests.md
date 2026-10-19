# Testing the arrangement code

Every test here is vitest and every one is pure: nothing mounts a React component and nothing starts
an engine. That constraint shaped the code — logic that decides what lands in a file is pulled out of
the components into modules a test can import — and it is also the gap: a green run says nothing
about a gesture's feel or a drawing. Exercise those in the running app.

## Running them

```bash
npm test                                   # every workspace, from the repo root
cd apps/k7/frontend && npx vitest run      # the frontend's pure modules
cd packages/commands && npx vitest run     # the verbs
cd packages/song-edit && npx vitest run    # the k7x writers
npx vitest run src/snap.test.ts            # one file, from inside its package
```

Lint must pass on any TypeScript you touch: `npm run lint` (biome). `npm run lint:docs` refuses a
source comment or a Markdown page naming a file that is not there.

## What covers what

### Frontend (`apps/k7/frontend/src/`)

| Test | Pins |
|---|---|
| `snap.test.ts` | Grid, relative (Ctrl) and free (Shift) snapping; the song-start floor. |
| `timelineTools.test.ts` | Each tool's line, and the refusals at an event's head and tail. |
| `timelineMode.test.ts` | The derived mode, and that a pending move does not own the keys. |
| `clipboard.test.ts` | Copy by start, relative coordinates, paste offsets, dropped rows, carried placement fields. |
| `pendingEdits.test.ts` | What each one-shot line predicts on the lanes. |
| `timelineDrop.test.ts`, `fileDrop.test.ts` | Kind by extension, clip id, lane walking, the report; accepting a file drag. |
| `rows.test.ts`, `rulerTicks.test.ts` | The row model; the ruler's ladders and labels. |
| `videoDrag.test.ts` | Picture drags in seconds. |
| `historyMarks.test.ts` | Which lanes, clips and nodes a journal step lights. |
| `keys.test.ts`, `commandFill.test.ts`, `contextMenu.test.ts` | Key resolution, caret answers for a command's form, menus derived from the catalogue. |
| `clipLoop.test.ts`, `clipInstances.test.ts`, `clipEnvelope.test.ts`, `barWindow.test.ts`, `clipWarp.test.ts`, `clipOps.test.ts` | Loop marks, repeated material, the activity envelope, the waveform's bar window, file/beat conversion for warp points, process lines. |
| `rollDrag.test.ts`, `stepGrid.test.ts`, `gridCaret.test.ts`, `curveDraft.test.ts` | Note gestures, step grid, the grid caret, curve drafts. |
| `takes.test.ts`, `takeCounter.test.ts`, `midiTake.test.ts`, `midiIn.test.ts`, `webmidi.test.ts`, `laneInput.test.ts`, `transportPanic.test.ts` | Comp lines and spans, the take counter, MIDI take trimming, device matching, inputs, the double-stop panic. |
| `exportArgs.test.ts`, `gainTrim.test.ts`, `mixerStrips.test.ts`, `apps/k7/frontend/src/mastering/controls.test.ts` | Export syntax, the Fix trim, strip order, the mastering control list. |

### Verbs (`packages/commands/src/`)

`eventsMove.test.ts`, `eventsRemove.test.ts`, `eventStatus.test.ts`, `eventLoop.test.ts`,
`eventGain.test.ts`, `eventTakes.test.ts`, `eventProcess.test.ts`, `crossfade.test.ts`,
`curvePoint.test.ts`, `curveSet.test.ts`, `trackAutomation.test.ts`, `notesRegion.test.ts`,
`noteVelocity.test.ts`, `sequenceDouble.test.ts`, `sequenceRecord.test.ts`, `trackMuteSolo.test.ts`,
`trackHighlight.test.ts`, `trackOrder.test.ts`, `trackGroup.test.ts`, `trackInput.test.ts`,
`projectMaster.test.ts`, `projectConsole.test.ts`, `refusal.test.ts`, and `commandSpec.test.ts`, which
holds the catalogue itself to its rules (both languages present, readable sentences at most 60
characters, known completion providers). `packages/commands/src/testHost.ts` is the fake
`CommandHost` they run against.

### Writers (`packages/song-edit/src/`)

`moveEvent.test.ts`, `clipResize.test.ts`, `eventWindow.test.ts`, `eventFade.test.ts`,
`eventLoop.test.ts`, `eventWarp.test.ts`, `loopWindow.test.ts`, `crossfade.test.ts`,
`materialCut.test.ts`, `insertTime.test.ts`, `onsets.test.ts`, `sequenceDoubleLoops.test.ts`,
`addTrackPlacement.test.ts`, `trackMix.test.ts`. The house style is to
assert that **exactly one line** of the file changed, as `moveEvent.test.ts` does — that is the
property the whole write path is built to keep.

### Other packages

| Package | Tests |
|---|---|
| `packages/ui-timeline/src/` | `panZoom.test.ts` (which wheel zooms, the factor, the ceiling), `ticks.test.ts`, `drag.test.ts` |
| `packages/ui-waveform/src/` | `ticks.test.ts`, `spectrum.test.ts`, `spectrumColour.test.ts`, `contour.test.ts` |
| `packages/audio-probe/src/` | `trimGate.test.ts`, `waveform.test.ts`, `key.test.ts` |
| `packages/take-render/src/` | `recordTake.test.ts`, `materialRender.test.ts` |
| `packages/audio-passes/src/` | `processChain.test.ts`, `peakPass.test.ts`, `coldPass.test.ts` |
| `packages/translator/src/` | `dawproject.test.ts`, `ableton.test.ts`, `abletonZip.test.ts`, `emitNodes.test.ts` |
| `packages/engine-browser/src/` | `meter.test.ts` (meter fill, clip latch, peak hold) |
| `packages/file-service/src/` | `history.test.ts`, `takeArm.test.ts`, `renderers.test.ts`, `render.test.ts`, `importDrop.test.ts` |

## Not covered

No test mounts `TimelineTab`, `AudioClipPanel`, `PianoRoll`, `MasterMeter`, `MasteringTab` or
`HistoryPanel`; `apps/k7/frontend/src/hooks/useShare.ts`, `apps/k7/frontend/src/hooks/useTrackControls.ts` and the `/export` route have no test
either. When a change touches one of them, move the decision you are changing into a pure module
first and test it there.

## See also

- [Extending: a new gesture or verb](./29-extending-arrangement.md)
