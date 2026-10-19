# Arrangement code: where it lives

This range (pages 20 to 29) covers the arrangement side of k7: the timeline, clip and note editors,
automation rows, recording and takes, the mixer, the master meter and the mastering surface, export
and bouncing, and the import of other DAWs' projects. The song pipeline those edits land in
(schemas, compile, file service) is the next range; the chains graph the mixer strips are drawn by
is the one after.

## The map

| Concern | Where |
|---|---|
| Timeline pane | `apps/k7/frontend/src/components/TimelineTab.tsx` |
| Its pure helpers | `apps/k7/frontend/src/rows.ts` (row model), `snap.ts`, `timelineTools.ts`, `timelineMode.ts`, `clipboard.ts`, `pendingEdits.ts`, `timelineDrop.ts`, `fileDrop.ts`, `clipLoop.ts`, `clipInstances.ts`, `historyMarks.ts` — all under `apps/k7/frontend/src/` |
| Ruler, grid, ticks | `apps/k7/frontend/src/components/Ruler.tsx`, `packages/ui-timeline/src/ticks.ts` |
| Zoom, pan, drag, lane geometry | `packages/ui-timeline/src/panZoom.ts`, `drag.ts`, `lanes.ts` |
| Minimap | `apps/k7/frontend/src/components/Minimap.tsx` |
| What a clip block draws | `apps/k7/frontend/src/components/ClipActivity.tsx`, `ClipContent.tsx` |
| Audio clip panel | `apps/k7/frontend/src/components/AudioClipPanel.tsx`, `EventGainSlider.tsx`, `LoopBrace.tsx`, with `clipWarp.ts`, `clipOps.ts`, `barWindow.ts`, `waveMode.ts` |
| Waveform drawing | `packages/ui-waveform/src/Waveform.tsx`, `spectrum.ts`, `ticks.ts` |
| Waveform data | `packages/audio-probe/src/waveform.ts` (envelope slicing, beat grid), `packages/file-service/src/waveformOps.ts` (serving it) |
| Trim gate | `packages/audio-probe/src/trimGate.ts` |
| Note views | `apps/k7/frontend/src/components/PianoRoll.tsx`, `apps/k7/frontend/src/hooks/useRollGestures.ts`, `rollDrag.ts`, `rollMode.ts`; `SequencerPanel.tsx`, `apps/k7/frontend/src/hooks/useStepPads.ts`, `stepGrid.ts`; `ClipViewModes.tsx`; grid caret in `apps/k7/frontend/src/hooks/useGridCaret.ts` + `gridCaret.ts` |
| Curve editor | `apps/k7/frontend/src/components/CurveEditor.tsx`, `CurvePlot.tsx`, `CurveKnob.tsx`, `CurveConditions.tsx`, `curveDraft.ts` |
| MIDI | `apps/k7/frontend/src/webmidi.ts`, `midiIn.ts`, `midiControl.ts`, `midiActivity.ts`, `apps/k7/frontend/src/hooks/useMidiRecording.ts`, `apps/k7/frontend/src/hooks/useMidiControl.ts`, `apps/k7/frontend/src/components/MidiTakeRoll.tsx` |
| Takes | `apps/k7/frontend/src/takes.ts`, `takeCounter.ts`, `apps/k7/frontend/src/hooks/useTakeRecording.ts`, `apps/k7/frontend/src/components/TakesView.tsx`, `TakeRow.tsx`, `CompStrip.tsx`; server side `packages/file-service/src/takeArm.ts`, `packages/take-render/src/recordTake.ts` |
| Mixer state | `apps/k7/frontend/src/hooks/useTrackControls.ts`, `mixerStrips.ts`; strips drawn by `packages/ui-chains-react/src/DomChains.tsx` |
| Master meter | `apps/k7/frontend/src/components/MasterMeter.tsx`, `gainTrim.ts`, `packages/engine-browser/src/meter.ts` |
| Mastering surface | `apps/k7/frontend/src/components/MasteringTab.tsx`, `apps/k7/frontend/src/mastering/controls.ts`, `apps/k7/frontend/src/mastering/bindings.ts` |
| Export | `apps/k7/frontend/src/exportArgs.ts`, `apps/k7/frontend/src/hooks/useShare.ts`, `apps/k7/frontend/src/components/SharePanel.tsx`; `packages/file-service/src/shareOps.ts`, `renderers.ts` |
| Offline renders | `packages/take-render/src/` (renderer, material split/consolidate, recorded takes) |
| Bouncing through a chain | `packages/audio-passes/src/processChain.ts`, `peakPass.ts`, `coldPass.ts` |
| Import | `packages/translator/src/` (`dawproject.ts`, `ableton.ts`, `abletonZip.ts`, `emit.ts`, `params.ts`), called from `packages/file-service/src/projectLifecycle.ts` |
| Undo journal | `packages/file-service/src/history.ts` (server), `packages/project-shell/src/undo.ts` (client), `apps/k7/frontend/src/components/HistoryPanel.tsx` |
| The verbs | `packages/commands/commands.yaml` (names, args, menus), `packages/commands/src/commands.ts` and `packages/commands/src/verbs/` (handlers) |
| The writes | `packages/song-edit/src/` — `trackMix.ts` (placements), `materialCut.ts`, `insertTime.ts`, `crossfade.ts`, `eventLoop.ts`, `eventGain.ts`, `onsets.ts`, `takeEdit.ts`, `projectEdit.ts` (module params, warp, bindings) |
| Key bindings | `apps/k7/frontend/src/keys.ts` |
| Shell-local verbs | `apps/k7/frontend/src/palette.ts` (`LOCAL_COMMANDS`), `localCommands.ts`, and `runLocalCommand` in `apps/k7/frontend/src/App.tsx` |
| Right-click menus | `apps/k7/frontend/src/contextMenu.ts` |

## Three rules that shape all of it

**Every edit is a command line.** A drag, a key, a button and a right-click entry all produce a
line of the same vocabulary the CLI speaks, and that line goes through `/command` on the file
service. There is no second write path for the timeline. This is what gives every gesture an undo
step, a typed equivalent and a log line, and it is why a gesture is designed around ONE verb:
two verbs would be two journal entries for one act. See
[The edit path](./21-edit-path.md).

**The browser holds only view state.** Caret, selection, zoom stack, tool, ruler unit, expanded
lanes, MIDI arm and the clipboard live in React state and are never written. Loop region and audio
arm live in the engine's session. Everything else is a file.

**Nothing mounts a component in a test.** The frontend's tests cover pure modules only, which is
why so much logic sits in small files beside the components (`snap.ts`, `clipboard.ts`,
`timelineTools.ts`, `pendingEdits.ts`…): what decides what lands in a file is kept where a test can
reach it. See [Testing](./28-arrangement-tests.md).

## Pages in this range

- [The edit path: gesture to k7x to engine](./21-edit-path.md)
- [The timeline component](./22-timeline-component.md)
- [Clip and note editors, curves](./23-clip-editors-code.md)
- [MIDI, recording and takes](./24-recording-code.md)
- [Mixer, meters and mastering](./25-mixer-mastering-code.md)
- [Rendering, export and bouncing](./26-render-process-code.md)
- [The translator](./27-translator.md)
- [Testing the arrangement code](./28-arrangement-tests.md)
- [Extending: a new gesture or verb](./29-extending-arrangement.md)
