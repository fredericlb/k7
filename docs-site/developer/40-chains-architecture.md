# Chains graph: architecture

The chains view draws a project's routing graph and lets the user edit it. Four layers take part,
and each is a separate package so that a lower layer never drags in a higher one.

| Layer | Where | Role |
|---|---|---|
| Wire types | `packages/graph-model` | `WebGraph` and its parts, as the browser receives them. Types only, plus the few values both ends must agree on. |
| Compile | `packages/file-service/src/graphDoc.ts` (route `GET /graph` in `packages/file-service/src/routes/files.ts`) | Reads the project folder through `@studio/song` and answers a `WebGraph`. |
| Layout | `packages/ui-chains` | Pure TypeScript: `WebGraph` to positioned nodes and edges, via dagre. No React, no DOM. |
| Rendering | `packages/ui-chains-react` | `DomChains`: HTML cards over a canvas of cables, with an SVG layer for labels and hit paths. |
| Host | `apps/k7/frontend/src/components/ChainsTab.tsx` and siblings | Fetches the graph, runs the layout, mounts `DomChains`, turns gestures into commands. |

## Data flow

```text
project folder ── @studio/song (loadGraph, loadCurves, assemblies)
   │
   ▼
file service GET /graph  ──►  WebGraph (JSON)
   │
   ▼
ChainsTab: buildGraph → layout (dagre) → foldAssemblies → withOpenTabs
   │
   ▼
DomChains  ── gestures ──► callbacks ──► command lines ──► file service POST /command
                                                              │
                                     reload of /graph  ◄──────┘
```

`GET /graph` takes `?at=<rel>` to compile a folder other than the open project; the Libraries
tab's chain editor (`apps/k7/frontend/src/components/ChainsBuilder.tsx`) uses it to draw a library
chain with the same pipeline.

Live values do not travel through `WebGraph`. Plugin parameter values come from
`@studio/engine-browser/params` (`PluginParamsStore`), levels and the mixer state from the engine
store; `DomChains` subscribes per widget, so a parameter frame re-renders a knob and not the graph.

## Choices

- **dagre owns layout and edge routing.** Nothing in the host or the renderer computes a node
  position or a cable route by hand; they consume dagre's numbers. Pinned positions
  (`positions:` in the graph file) are honoured by the layout, which places only the rest.
- **Every edit is a command.** The renderer reports intent (`onConnect(from, to)`,
  `onMoveNode(module, x, y)`...). The host turns it into a line of the command catalogue
  (`graph chain connect`, `graph move`...) and sends it to the file service. The graph on screen
  is then re-read. There is no second write path, so the command bar, the context menu and a
  gesture cannot disagree. The verbs live in `packages/commands`; see the commands section of the
  developer guide.
- **The renderer is a library with several hosts.** In `apps/k7/frontend/src/components`:
  `ChainsTab.tsx` (the full pane), `GraphPanel.tsx` (one lane's path in the bottom panel),
  `TrackModulesPane.tsx` (one lane's modules side by side), `ChainsBuilder.tsx` (library chains),
  and the module builder's preview through `@studio/ui-chains-react/module-preview`. Every
  callback prop of `DomChains` is optional, so a read-only host passes none.
- **Cables are on a canvas outside the transformed world.** Cards are HTML inside one element
  moved by a CSS transform (pan and zoom). A canvas scaled by CSS goes blurry, so the cable canvas
  sits outside that element and applies the same camera to its 2D context.
- **Assemblies are a drawing fact.** The compiler never sees a box; `foldAssemblies` replaces
  members with a box after the layout's graph is built. Whether a box is open is host session
  state.
- **Optimistic UI where a round trip is felt.** A bypass click and a knob drag show at once; the
  next `/graph` or engine frame confirms. Toggles that the file is the truth for (mute, solo, arm,
  module fields) wait for the reload instead, so a fast double-click cannot leave the button
  inverted against the file.

## The k7 host

`ChainsTab.tsx` holds what outlives the pane: the camera (`camStore`, because `DomChains`
unmounts with its pane), the positions drawn last (so an edit does not reorganise the picture),
which assembly boxes are open, and the pending bypasses. `App.tsx` provides the callbacks:

| Gesture | Callback | Command written |
|---|---|---|
| `+` on a cable, then a module picked | `onEdgeInsert` | `node insert <before> <after> <node> [x,y]` (after `node new`) |
| Branch button on a row seam | `onEdgeInsert` with `stack` | `node stack <node> <new>` |
| Right-click on empty canvas, then a pick | `onCanvasInsert` | `node new ...` then `graph move <node> <x> <y>` |
| New cable landed | `onConnect` | `graph chain connect <from> <to>` |
| Lifted cable dropped on canvas | `onDisconnect` | `graph chain disconnect <from> <to>` |
| Lifted cable landed elsewhere | `onReplug` | `graph chain replug ...` |
| Curve cable landed on a knob | `onAutomate` | `node automate <module> <param> <curve> [trigger]` |
| Card dropped after a header drag | `onMoveNode` | `graph move <module> <x> <y>` |
| Minimap Organize | `onOrganize` | `graph organize` |

The line builders are in `apps/k7/frontend/src/nodeInsert.ts`; the placeholder card drawn while
the commands run is `apps/k7/frontend/src/pendingNode.ts`. The module picker is
`apps/k7/frontend/src/components/ModulePicker.tsx`; it falls back to pre-writing the command in
the bar when the catalogue (`GET /module-catalogue`) has not answered.

Right-click menus are derived from the catalogue: `apps/k7/frontend/src/contextMenu.ts` maps the
`GraphMenuCtx` the renderer reports to every command whose `menu:` lists that entity (`node`,
`param`, `tap`, `assembly`, `curve`...).

## Tests

- `packages/ui-chains`: `npm test -w @studio/ui-chains` (vitest). `graph.test.ts` covers the build
  and the layout; most modules have a sibling test. `npm run bench -w @studio/ui-chains` runs
  `graph.bench.ts`.
- `packages/ui-chains-react`: `npm test -w @studio/ui-chains-react` covers the pure helpers
  (camera, minimap, node motion, module fields). `DomChains.stories.tsx` renders the component in
  Storybook (`npm run storybook` at the root).
- The k7 frontend's tests cover pure logic (`nodeInsert`, `contextMenu`, `ModulePicker`); nothing
  mounts the graph, so check interaction changes in the running app.
