# graph-model and ui-chains

## `@studio/graph-model`

`packages/graph-model` is the routing graph as the browser receives it. It exists apart from
`@studio/web-protocol` so that drawing a graph does not import auth, workspaces or the engine
registry. It has two entry points and no build step.

| Export | File | Contents |
|---|---|---|
| `@studio/graph-model` | `packages/graph-model/types.ts` | `WebGraph`, `WebChain`, `WebChainStep`, `WebOut`, `WebWidget`, `WebModuleUI`, `WebCurve`, `WebAutomation`, `WebRackSound`, `WebCc`, `WebTrackClip`, `WebNodeAssembly`, `WebPlug`, plus `MODULE_CATEGORIES`, `PORT_SEP` (`#`), `splitPort`/`portRef`, `TRACK_OUTPUTS` and `automationLanes`. |
| `@studio/graph-model/panel` | `packages/graph-model/panel.ts` | `panelWidgets(ui)` (every widget of a panel, shared ones first, then each tab's) and `hasTabs(ui)`. Every lookup by `bind` (MIDI, automation, file pickers) goes through `panelWidgets`, so a widget on a tab is never missed. |

### The shape

- `WebGraph.chains` maps a chain name to a `WebChain`: where it comes `from` (a lane, or another
  chain), its ordered `use` steps, and its weighted `out` edges.
- A `WebChainStep` is one node: its category, what it emits, its ports and events, its merged
  panel (`ui`), its parameter values, its engine and alternative choices, its `pluginId` (the
  engine's address for live parameter sets), and flags for the failure cases (`missing`, `stub`,
  `notSupported`, `unknownPlugin`).
- Side maps carry what is not a chain: `positions` (pins from the graph file), `trackSignals`,
  `trackColors`, `trackClips`, `trackMixers`, `stacks` (a chain project's subchains), `frozen`
  and `autoFrozen`, `tapFeeds`, `curves`, `modules` (doc-note text), `assemblies`, and
  `warnings`.

The producer is `packages/file-service/src/graphDoc.ts`. When you add a field, add it there and
in `types.ts` together; nothing else checks that the two agree.

## `@studio/ui-chains`

`packages/ui-chains` turns a `WebGraph` into geometry. It is framework-agnostic and imported
through its `package.json` subpaths (`@studio/ui-chains/graph`, `@studio/ui-chains/cables`...).
dagre (`@dagrejs/dagre`) computes the layout.

### The pipeline

`graph.ts` is the core (and is over the usual size limit because the build and the layout share
most of their constants):

| Function | Role |
|---|---|
| `buildGraph(...)` | `WebGraph` to `GraphNode`s and `GraphEdge`s: lanes, inputs, module cards with their panels sized, curve cards, sinks, ports and jacks. |
| `layout(...)` | Runs dagre and returns a `LaidOutGraph`, honouring pinned positions. |
| `subgraphForTrack`, `trackModules`, `trackInputs` | One lane's slice of the graph, for the bottom panel and the per-lane row. |
| `moduleRow`, `alignModuleRank`, `spaceModulesEvenly`, `masterRunAside`, `pushBelowInputs`, `pushAsideFrames` | Arrangements and post-passes over the laid-out graph. |
| `withOpenTabs` | Resizes cards by the tab each one has open. |
| `nodeSize`, `widgetRect`, `jackPoint`, `cablePath` | Geometry helpers the renderer reads. |
| `rackUI`, `inputUI`, `cameraUI`, `midiInUI`, `TRACK_UI`, `MAIN_OUT_UI`, `RENDER_UI` | Panels synthesised for cards that have no `ui` file. |
| `widgetNorm`, `widgetDenorm`, `widgetText`, `widgetTyped`, `pairValue` | Value mapping between a widget's range and its 0..1 travel. |

### The other modules

| Module | Role |
|---|---|
| `assembly.ts` | `foldAssemblies(drawn, built, open)`: a closed box replaces its members (one knob per promoted param, bound `asm:<Name>`); an open box becomes a titled frame. |
| `stackLayout.ts` | The stack view: one column per lane, edge to edge, no dagre. |
| `rowSeams.ts` | Where a glued row offers its `+`, and the branch (stack) button in a chain project. |
| `gridFit.ts` | Folds a card's widget grid to a maximum number of rows or columns. |
| `anchorRight.ts` | Lifts a row's trailing mixer card out so the host can pin it to the pane's edge. |
| `curvePlacement.ts` | Puts a curve card left of the node it drives. |
| `cables.ts` | Cable drawing geometry: smoothing, arc-length resampling, the insert `+` midpoint. |
| `cableCanvas.ts` | The same cables traced onto a 2D canvas. |
| `hang.ts` | A patch cable's rest shape and its spring physics. |
| `flow.ts` | How hard a cable ripples, per kind of signal. |
| `noteLoad.ts` | What a MIDI cable carries at an instant (the velocities sounding there). |
| `patchGesture.ts` | What a press or release on a socket does: press-drag-release versus click-then-click. |
| `multiSelect.ts` | Shift+click selection, and which selected nodes are linked (same ref, same engine). |
| `bindings.ts` | Joins a surface's `mapping:` to the compiled chains: which control moves which param on which plugin. |
| `automationDepth.ts` | How far a curve moves the control it drives, drawn as the knob's gauge. |
| `groupEdge.ts` | Insets for widgets sharing a group's labelled edge. |
| `modulePreview.ts` | One module as a minimal `WebGraph` (source, module, sink), for the builder's preview. |
| `takeClock.ts` | What a recorder card shows over its waveform. |
| `decimate.ts` | A take's waveform reduced to the pixels available. |
| `zoomGesture.ts` | How much one wheel event zooms; a trackpad pinch has its own rate. |
| `lcdScreen.ts` | The contract a `widgets.js` is written against (draw frame, pointer frame, `visible`), and the rolling history of audio taps. |
| `widgetSandbox.ts` | The page side of the widget sandbox (see below). |
| `widgetRuntime.ts` | What runs inside the sandbox: compiles each `widgets.js`, answers `visible`, draws screens on an `OffscreenCanvas`. |

### The widget sandbox

A panel's `widgets.js` is code from a library or a workspace, so it never runs in the page. One
hidden `sandbox="allow-scripts"` iframe per page (opaque origin, no network) runs a worker that
compiles every script and draws each screen to an `OffscreenCanvas`, returning a bitmap. Every
call is a postMessage request, so answers are asynchronous; the React side
(`packages/ui-chains-react/src/widgetScript.ts`) shows the last known answer. A request that times
out means a hung script: the iframe is rebuilt and that script text is not run again.

`widgetRuntime` is shipped into the iframe as source text (`Function.prototype.toString`), so it
must stay self-contained: no imports, no classes, no async, nothing a bundler would turn into a
helper. `widgetRuntime.test.ts` and `widgetSandbox.test.ts` cover it.

## Testing

```bash
npm test -w @studio/ui-chains
npm run bench -w @studio/ui-chains
```

Most modules have a sibling `*.test.ts`. The layout is tested on numbers, not pictures: when a
change moves cards, the assertion should say which relation (above, left of, not overlapping)
must hold.
