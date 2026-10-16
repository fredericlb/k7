# ui-chains-react: the renderer

`packages/ui-chains-react` draws what `@studio/ui-chains` laid out. It is the renderer only: the
fetching, the chain list and the parked camera stay in each host.

| Export | File |
|---|---|
| `@studio/ui-chains-react` | `src/DomChains.tsx` (the component, its prop types, `GraphMenuCtx`, `ChainsIcons`, `ChainsCamApi`, `SinkPlay`, `SongClockProvider`) |
| `@studio/ui-chains-react/module-icons` | `src/moduleIcons.tsx` |
| `@studio/ui-chains-react/module-preview` | `src/ModulePreview.tsx` |
| `@studio/ui-chains-react/node-load` | `src/nodeLoad.ts` |

## Structure of the drawing

Three layers, in z-order:

1. A **canvas** of cables (`cableCanvas.ts` from ui-chains), outside the transformed world so it
   stays sharp; it applies the camera to its 2D context.
2. An **SVG** layer for cable labels, automation arrows and hit paths.
3. **HTML cards** inside `.dgx-world`, moved by one CSS transform.

The stylesheet is `src/chainsCss.ts`, scoped to `.dgx` and injected once.

## Key props

`DomChains` requires `icons` (the host's glyph set, `ChainsIcons`), `graph` (a `LaidOutGraph`),
`selected`, `onSelect` and `command`. Everything else is optional and switches a feature on:

| Group | Props |
|---|---|
| Editing the graph | `onEdgeInsert`, `seams`, `onCanvasInsert`, `onConnect`, `onDisconnect`, `onReplug`, `onMoveNode`, `onAutomate`, `onContextMenu` |
| Node settings | `onBypassModule`, `onModuleField`, `onAlternative`, `onEngine`, `onPresets`, `onPresetStep`, `presetNames`, `onSetModuleAsset`, `onAssetBrowse`, `onLibraryBrowse`, `onTapEdit`, `onThawAutoFreeze`, `onToggleAssembly` |
| Live values | `pluginParamsStore`, `setPluginParam`, `moduleParams`, `onModuleParam`, `trackControls`, `onTrackToggle`, `onTrackSet`, `trackOrder`, `videoSpans`, `noteLanes`, `rackLit`, `midiActivity`, `onWatchWaveform`, `sounds` |
| Devices | `trackInputs`, `onPickTrackInput`, `onRecorder`, `onTriggerRack`, `sinkPlay`, `onProjectField` |
| Camera | `camStore`, `onCamReady`, `fitKey`, `fitAxis`, `fitMaxZoom`, `fitPad`, `fixed`, `row`, `alwaysDetailed`, `minimap`, `onOrganize`, `onStack`, `stacked`, `organizeKey`, `motion` |
| Other | `marked` (cards to highlight), `openTabs`/`onOpenTab`, `engineWarnings`, `rehearsal` (show picks, write nothing) |

`onBypassModule` and `onModuleField` are separate from `command` because those edits change the
graph's shape or have no optimistic value, so the host must reload after them.

## Gestures

- **Selection**: click selects; Shift+click toggles membership (kept inside the component; the
  host only sees its single `selected`); Shift+drag on empty canvas selects by rectangle.
  Linked editing across a selection follows `multiSelect.ts`.
- **Widgets**: drags send live values coalesced to one per frame and commit on release. Shift
  gives fine steps. Double-click opens `ValueEditor.tsx`. A drag on a frozen module is refused; on
  an automatically frozen one, `onThawAutoFreeze` runs first.
- **Patch cables**: `patchGesture.ts` decides arm or land. A free output jack starts a cable; an
  occupied jack lifts the first cable's end. Dropping on bare canvas deletes the lifted cable;
  `Esc` or any right-click puts it back. The loose end is moved by direct DOM writes, not React
  state.
- **Pin**: dragging a card by its header pins it through `onMoveNode`. A row and the members of
  an open box refuse.

## Camera

`src/camera.ts` is the camera as arithmetic: wheel notch to zoom goal, zoom around the cursor,
the glide toward the goal. The camera lives in refs, outside React; a frame loop writes the
transform. Pinch (`ctrlKey` wheel events) has its own rate; two-finger trackpad scrolls pan 1:1;
touch pinch is absolute from the gesture's start. Double-click a card flies onto it, and on empty
canvas flies back. `fit()` frames the graph once per `fitKey`; after the user has moved the camera,
resizes no longer re-frame unless `fixed`. `src/lcdZoom.ts` publishes the settled zoom so LCD
canvases size their pixels for it.

`src/Minimap.tsx` draws every card as a block with the pane as a frame, off the camera ref; its
buttons are Zoom fit, Organize (`onOrganize`) and the stack toggle (`onStack`).

## Motion

`src/nodeMotion.ts` implements FLIP: React draws every card at its final place, and the module
carries the offset it is drawn with, so cards slide between layouts. A layout after an organize
(`organizeKey`) is watched: cards slide and the camera glides to frame the result.

## Widgets on cards

| File | Draws |
|---|---|
| `src/LcdScreenWidget.tsx` | An LCD screen: a canvas behind glass, painted by a bitmap the widget sandbox returns. |
| `src/widgetScript.ts` | React's view of the sandbox: a script's shape and its `visible` answer, last known. |
| `src/TapWidget.tsx` | A rack pad: audition, note, sample. |
| `src/PresetButton.tsx` | The engine and preset dropdown on a card's header. |
| `src/Seams.tsx` | A glued row's `+` and branch buttons. |
| `src/moduleField.ts` | What an intrinsic dropdown shows, read from the node's own field. |
| `src/nodeLoad.ts` | The plugin cost shown in a card's corner. |

## Writing a new host

1. Fetch a `WebGraph` (from `GET /graph` or built in the browser, as `modulePreview.ts` does).
2. Run `buildGraph` and `layout` from `@studio/ui-chains/graph`; fold assemblies if the graph has
   any.
3. Mount `DomChains` in an element that has a real size: `fit()` frames to the host and a
   `display: none` container measures zero.
4. Pass only the callbacks you support. Keep the camera in a `camStore` if the component can
   unmount while the view persists.

## Tests

`npm test -w @studio/ui-chains-react` runs the pure tests (camera, minimap, node motion, module
fields, LCD zoom, node load). The component itself is exercised in Storybook through
`src/DomChains.stories.tsx` (`npm run storybook` at the repository root) and in the running app.
