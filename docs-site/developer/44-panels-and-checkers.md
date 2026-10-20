# Panels and their checkers

A panel is a module's widget grid. Its format, the code that draws it, and the two scripts that
check the library's panels are described here. The user-facing reference for the file is the
Panels page of the user guide.

## The format

The schema is `UISchema` / `UiFileSchema` in `packages/song-schema/src/yaml/moduleSchema.ts`
(strict: an unknown key is an error). `WIDGET_TYPES` lists the fourteen widget kinds. The rules
that cross widgets live elsewhere:

| Rule | Where |
|---|---|
| Tab names 1 to 10 characters, unique; `vertical.tabs` match `tabs` by name and order | the schema |
| Horizontal layout at most 4 rows; `vertical` at most 4 columns, required past 4 columns; both layouts offer the same binds per page | `twinIssues`, `packages/panel-rules/src/layoutTwins.ts` |
| In bounds, no overlap except a group framing a widget | `gridIssues`, same file, and `packages/panel-rules/src/groupGeometry.ts` |
| No knob, slider, fader or number on an `@` parameter; EQ bands as faders; no lone group | `atControlIssues`, `eqBandIssues`, `loneGroupIssues` in `packages/panel-rules/src/aiOrganize.ts` |

Panels inherited through `extends` merge their top-level `widgets` per id
(`packages/song/src/moduleResolve.ts`); widgets marked `hidden` are dropped when the panel is
resolved.

On the wire, a panel is `WebModuleUI` with `WebWidget`s (`packages/graph-model/types.ts`). The
renderer draws it in `packages/ui-chains-react/src/DomChains.tsx`, folding wide grids with
`packages/ui-chains/src/gridFit.ts`. `widgets.js` runs in the widget sandbox
(`packages/ui-chains/src/widgetSandbox.ts`, `packages/ui-chains/src/widgetRuntime.ts`) against the
contract in `packages/ui-chains/src/lcdScreen.ts`.

## Binds

A `bind` is the plugin's parameter name verbatim. Nothing at load time can check it against the
plugin: the engine drops a value for an unknown parameter with a warning, so a wrong bind shows
as a control that moves and does nothing. That is what `lint:panels` exists for.

Where parameter names come from:

- **Built-in plugins**: `packages/song-schema/src/builtinParams.generated.json`, generated from real
  instances by `engine/k7-runtime/scripts/gen-builtin-params.mjs`, and read through
  `packages/song-schema/src/builtinParams.ts` (`builtinPluginFor`). Re-run the script when the
  engine's built-ins change.
- **External plugins**: only a loaded instance knows. The engine binary answers
  `--dump-params-ext <format> <id> <state>`.
- **jsdsp and faust**: the module's own source declares them.

## `npm run lint:panels`

Runs `packages/song/scripts/checkPanelBinds.ts`.

```bash
npm run lint:panels
npx tsx packages/song/scripts/checkPanelBinds.ts [library root] [--only <name filter>] [--json]
```

For every module folder with a panel under the library root (default `k7-core`), it collects each
`bind` and `pair` that is neither an `@` intrinsic nor a file parameter, resolves the module's
plugin (its own `plugin:`, or by following `extends`, with `@engine/` refs looked up in the plugin
scan cache), lists the plugin's real parameters, and reports the binds it lacks, with a "did you
mean" when a name matches ignoring case and punctuation. It lists the panels it skipped (jsdsp,
faust and rack modules, plugins not installed) and exits 1 on any missing bind.

External plugins are instantiated by the engine binary: `$K7_RUNTIME`, or the first engine binary found
in the engine's CMake build directory, trying the presets `macos-clang`,
`windows-msvc/RelWithDebInfo`, `dev-gcc` and `dev-clang`. So the check is only meaningful on a machine where those plugins are installed, and
it is not part of `npm run lint` or of CI.

## `npm run lint:layouts`

Runs `packages/ui-module-builder/scripts/checkLayouts.ts`.

```bash
npm run lint:layouts
npx tsx packages/ui-module-builder/scripts/checkLayouts.ts [module dirs...]
```

With no argument it checks every `ui.k7x` under `k7-core`. For each panel:

1. It parses against `UiFileSchema`.
2. It applies `twinIssues` and, per page, `gridIssues`.
3. In both layouts, it applies `atControlIssues` and `eqBandIssues`, and the lone-group rule.
4. It compares with the panel committed at `HEAD`: every control the committed panel offered
   (`@` binds aside) must still be offered somewhere. A reorganised panel may move a control, not
   lose it.
5. Every `lcdscreen` id must have a draw function in the compiled `widgets.js`.

It prints the failing modules with their issues, then `N/M panels pass`, and exits 1 on any
issue. It reads no plugin, so it runs anywhere. It is not part of CI either: run it after editing
library panels, and after an AI organize run over many modules.

## Adding a widget kind

1. Add it to `WIDGET_TYPES` and its fields to the widget schema in
   `packages/song-schema/src/yaml/moduleSchema.ts`, and to `WebWidget` in
   `packages/graph-model/types.ts`.
2. Draw it in `packages/ui-chains-react/src/DomChains.tsx` and size it if needed in
   `packages/ui-chains/src/graph.ts`.
3. Offer it in the builder: `packages/ui-module-builder/src/widgetKinds.ts` and the inspector's
   fields in `packages/ui-module-builder/src/WidgetInspector.tsx`.
4. Describe it in `WIDGET_DOCS` in `packages/panel-rules/src/aiPrompt.ts`, so AI organize
   knows it, and extend `checkAiResult` if it has rules.
