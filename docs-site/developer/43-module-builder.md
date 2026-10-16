# The module builder

`packages/ui-module-builder` is the visual editor for a module folder: its module file, its panel
(`ui.k7x`/`ui.yaml`), its DSP source and its `widgets.js`. k7's frontend is its host.

## Entry points

| Export | File | What it is |
|---|---|---|
| `@studio/ui-module-builder` | `src/EngineBuilder.tsx` | `ModuleBuilder`, what hosts mount. It asks the store for the module's engines and, when there are any, draws the engine strip above `ModuleScreen`. |
| `./assembly` | `src/AssemblyBuilder.tsx` | The assembly template editor: member parameters, promotion checkboxes, the YAML beside them. |
| `./store` | `src/store.ts` | The `ModuleStore` interface a host implements. |
| `./module-ui` | `src/moduleUi.ts` | Reading and writing the panel file, keeping its header comment; each widget on one flow line with defaults omitted. |
| `./input-channels` | `src/InputChannelBar.tsx` | The mono/stereo and channel picker for `io: in` modules. |
| `./yaml-pane` | `src/YamlPane.tsx` | The CodeMirror pane, also reused by the media library's song and playlist editors. |
| `./param-drag` | `src/paramDrag.ts` | The drag payload of a parameter (MIME `application/x-studio-param`). |
| `./ai-organize` | `src/aiOrganize.ts` | AI organize's request format and checks, re-exported from `@studio/panel-rules`. |

`src/ModuleBuilder.tsx` holds `ModuleScreen` and is over the usual size limit: the screen owns
the four buffers and their save, and splitting it would scatter one transaction across files.

## The store seam

`ModuleStore` (`src/store.ts`) is everything the builder asks of whoever serves the files, in the
host's own path space:

| Method | Purpose |
|---|---|
| `read(path)` | One file's text, or `null` when absent. |
| `moduleUi(path)` | The panel beside a module, or where it would go plus a blank grid. |
| `dspSource?(path, file)` | The DSP source (`jsdsp.ts` or `dsp.dsp`). |
| `widgetsScript?(path)` | The `widgets.js` beside the module. |
| `engines?(path)` | The module's engines and its default. |
| `hints()` | The project's hints (parameter names and ranges by base, completions). |
| `write(path, text)` | Writes a file. May answer `{ path, note }` when the write landed elsewhere (an `@engine` ref materialising into a folder). |
| `publish?(path)`, `snapshotBase?(...)`, `bases?(path)` | Publish after a save, snapshot a plugin state as a base, list bases. |

k7's implementation is `moduleStore` in `apps/k7/frontend/src/api.ts`, over file-service routes
such as `/module-ui`, `/module-engines`, `/module-base`, `/module-base/snapshot` and
`/module-materialise` (`packages/file-service/src/routes/files.ts`).

## Saving

The builder is one of the few screens with an explicit Save. A module is several files that are
coherent only together, so autosave (which writes each buffer as soon as it parses) would publish
half a module. Save writes the module file, the panel, the DSP source and `widgets.js`, then calls
`publish` once. `Ctrl+S` is bound in `YamlPane` and on the parameters pane; vim's `:w` is
registered globally by `apps/k7/frontend/src/components/EditorPane.tsx` and lands on the same
save. Unsaved buffers are guarded against navigation.

## The parameter list

The parameters pane merges every source of parameter names, in this precedence for ranges: the
live engine (`pluginParamMeta`, read from the open project's engine), the plugin scan, the
built-in plugin's declared params, base hints, and the io intrinsics. It then adds the `@`
intrinsics the module's kind supports. Because the live list comes from the engine of the open
project, a library module's parameters are best read from a project where its plugin is loaded.

## The grid

- `src/WidgetGridEditor.tsx`: the grid, the palette (`src/widgetKinds.ts`), drag, resize, drop
  binding, the right-click menu (`src/GridMenu.tsx`).
- `packages/panel-rules/src/groupGeometry.ts`: group membership is geometric (wholly inside the box), and the clash
  rule.
- `src/WidgetInspector.tsx`: per-type fields; `retype` drops fields the new type lacks.
- `src/TabsColumn.tsx` and `src/panelTabs.ts`: tabs; one tab is never written.
- `src/widgetClipboard.ts`: an in-memory clipboard for the session, groups copied with what they
  frame, ids de-duplicated.
- `packages/panel-rules/src/layoutTwins.ts`: `LAYOUT_MAX = 4`; `twinIssues`, `gridIssues`, `reflowNarrow`,
  `alignTabs`.
- `src/autoLayout.ts`: Auto organize, local and deterministic: parameters sorted into families by
  name, one tab per family.

## AI organize

| Piece | Where |
|---|---|
| Builder side | `src/useAiOrganize.ts` (dialogs, Reset/Update, Copy for Claude Code via `src/claudeCodePrompt.ts`) |
| Request, prompt, checks | `packages/panel-rules/src/aiOrganize.ts`, `packages/panel-rules/src/aiPrompt.ts` (`checkAiResult`, `AI_RESULT_SCHEMA`) |
| Route | `apps/k7/backend/src/aiOrganize.ts`, mounted at `/api/ai`: `GET /api/ai/organize` says whether it is enabled and with which model, `POST` runs it |
| Settings | `apps/k7/backend/src/aiSettings.ts` (`GET`/`PUT /api/ai/settings`), `apps/k7/frontend/src/settings/AiSection.tsx` |

The backend calls the Anthropic API with the account's own key (write-only: reads return a
masked hint) and model (`DEFAULT_AI_MODEL` in `aiSettings.ts`). It streams, asks for a JSON-schema
output (`ui_yaml`, `widgets_js`, `notes`), and if the answer fails `checkAiResult` it sends the
issues back once for a repair. The response to the browser is NDJSON events (`status`, `done`,
`error`) with a heartbeat; closing the tab aborts. The result lands in the builder's buffers, not
on disk.

The checks are the same ones `npm run lint:layouts` applies to the library (see
[Panels and their checkers](./44-panels-and-checkers.md)), so an AI answer and a hand-made panel
are held to one standard.

## Opening it from k7

`App.tsx` lazy-loads `ModuleBuilder` and shows it in the editor's place, the editor fullscreened.
Openers: a module row in the file tree or the Libraries tab, the **Builder** button on a module
file's toolbar (`apps/k7/frontend/src/components/EditorTab.tsx`), and the local command
`ui builder <module>` (`apps/k7/frontend/src/palette.ts`). `ui assembly <ref>` opens
`AssemblyBuilder`. The preview under the panes is `ModulePreview` from
`@studio/ui-chains-react/module-preview`.

## Tests

`npm test -w @studio/ui-module-builder`. The tests cover the pure modules: `moduleUi`,
`autoLayout`, `aiOrganize`, `panelTabs`, `paramDrop`, `realPanels` (when the grid may call a panel unparsable). Nothing mounts the React screens.
