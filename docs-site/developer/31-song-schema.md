# song-schema: the file format

`packages/song-schema` defines every file a project is made of: one zod schema per file kind, a
reader/writer for the kinds k7 edits by hand-shaped text transforms, and the small pure modules the
rest of the codebase shares (timecodes, module vocabulary, playlists, stems, takes…). It has no
`node:` import: the browser imports it directly.

## Layout

| Path | Contents |
|---|---|
| `packages/song-schema/src/yaml/projectSchema.ts` | `ProjectFileSchema` (two tiers, both `.strict()`), `SettingsSchema` (loose), `PROJECT_SHAPES` (the five archetypes), `MASTER_MIN_DB`/`MASTER_MAX_DB`. |
| `packages/song-schema/src/yaml/placementSchema.ts` | `PlacementSchema` (one event), `TIMECODE` (the regex), `TIMECODE_KEYS` (keys whose value must be written quoted). |
| `packages/song-schema/src/yaml/entitySchemas.ts` | Clips (audio/video union, told apart by extension), sequences and notes, the four curve types and their conditions, picture lanes and shots, transitions. `ENTITY_SCHEMAS` maps folder name → schema. |
| `packages/song-schema/src/yaml/moduleSchema.ts` | `ModuleSchema` — every field a module, node or lane may carry — plus `AlternativeSchema`, `UISchema`/`UiFileSchema`, `WidgetSchema`, `ControllerFileSchema`, `ModuleConfigSchema`, `RackSchema`. |
| `packages/song-schema/src/yaml/chainSchema.ts` | `ChainFileSchema` with its structural refinements (first step, last step, lanes only in `start: true` chains, subchain rules), and the step predicates (`isEndStep`, `isCallStep`, `isTrackItem`, `itemsOf`, `expandCalls`). |
| `packages/song-schema/src/yaml/graphSchema.ts` | `GraphFileSchema` (`modules`, `bypassed`, `bus_only`, `tap_feeds`, `positions`). |
| `packages/song-schema/src/yaml/surfaceSchema.ts`, `surfaceRegistry.ts` | `SurfaceSchema`, the type ↔ layout table, the mapping skeletons, and the open registry a plugin adds a surface type to. |
| `packages/song-schema/src/yaml/assemblySchema.ts` | `AssemblyTemplateSchema` (library) and `AssemblyFileSchema` (project). |
| `packages/song-schema/src/yaml/mixSchema.ts`, `mixViewSchema.ts` | A set's cue sheet and the control → param binding a surface's `mapping` reuses. |
| the `*File.ts` modules of `packages/song-schema/src/yaml/` | Readers and text editors per kind: `trackFile`, `sequenceFile`, `curveFile`, `videoTrackFile`, `takeFile`, `chainFile`, `graphFile`, `moduleFile`, `uiFile`, `surfaceFile`, `assemblyFile`, `mixFile`, `alternativeFile`. |
| `packages/song-schema/src/yaml/validate.ts` | The router: path → parser, used by the editor and the loader alike. |
| `packages/song-schema/src/yaml/fields.ts` | The editor's completion vocabulary, derived from the schemas. |
| `packages/song-schema/src/yaml/sugar.ts`, `k7xIssues.ts` | k7x short forms and k7x-located findings. |
| `packages/song-schema/src/timecode.ts` | Timecode ↔ beats. |
| `packages/song-schema/src/moduleTypes.ts` | The module vocabulary: type folders and their default ports, built-in ends, namespaces, refs. |
| `packages/song-schema/src/keyframes.ts` | Shot animation keys and their evaluation. |
| other `src/*.ts` | `playlist`, `reference`, `songRef`, `presets`, `tasks`, `projectTags`, `libraryVersions`, `alternatives`, `engines`, `stems`, `takes`, `warpPoints`, `trackKind`, `trackColor`, `placementId`, `seqWindow`, `curveMath`, `builtinParams` (generated). |

## Choices

**Strict objects.** Almost every schema is `.strict()`: an unknown key is a typo, and silently
ignoring `paramz:` costs more than refusing it. The exceptions are deliberate: `settings.yaml` is
loose; a chain's node item is `.passthrough()` because its module fields are vetted by `parseModule`
after `NODE_ITEM_KEYS` are stripped; `plugin:` is a loose object because the plugin's shape is the
engine's business. Fields that are dead but still found on disk (`modules_from`, `video`, `type`) are
accepted and ignored rather than removed, because a strict refusal would make an old project
unopenable.

**Refinements, not unions, where the editor is mid-edit.** A widget's per-type fields are checked in a
`superRefine` over one flat object: a union would reject the half second where the user changed
`type` but not yet the fields, and would report a typo as a bare "Invalid input" with no line.
Transitions are widened with `z.preprocess` (`1` → `{ over: 1 }`) for the same reason.

**Cross-file references are not checked here.** `extends`, a placement's `ref`, a rack's `clip`
need the rest of the project; they are checked by `@studio/song` at compile time.

**YAML 1.2, always.** Every parser passes `version: "1.2"` so that `5:1:1` stays a string (YAML 1.1
reads it as base 60) and `on`/`off` stay strings. Writers still quote timecodes (`quoteTimecodes` in
`moduleFile.ts`, driven by `TIMECODE_KEYS`) and YAML 1.1 boolean-looking words, because other tools
read these files too.

**Defaults applied on the way out, never into the file.** `parseModule` sets `type: "plugin"` on the
returned value only when the module says neither `type`, `io` nor `extends`, so an inherited type is
never overridden and the file stays as terse as written.

## Validation: one router

`validateFile(path, text)` in `packages/song-schema/src/yaml/validate.ts` answers whether the
compiler could read `text` at `path`:

1. A `.k7x` path: k7x syntax first (`k7xSyntaxIssue`), then the kind's parser on the YAML view
   (`checkK7x`), findings relocated onto the k7x text's lines by key path.
2. A YAML path: YAML syntax first; a syntax error makes the result `malformed`.
3. `parserFor(path)` chooses the parser by folder and basename: presets, then `modules`/`_modules`
   (`ui`, `controller`, `config`, else `parseModule`), `nodes/`, `tracks/`, `chains/` (a library
   chain folder's `graph` is `parseGraph`), `clips/`, `sequences/`, `curves/`, `video_tracks/`,
   `views/mix`, root `chains`, `project`, `mix`. Unknown paths get `depth: "syntax"`.

The result is `{ ok, issues, depth, malformed }`, each issue `{ path, message, line?, col? }`.
`firstIssue` phrases one for a status line. The editor's autosave (`packages/ui-editor/src/autosave.ts`)
holds a malformed buffer, and holds a schema-failing one when the file on disk was valid.

An unknown key is reported by zod against its containing object; every parser rebuilds the path with
the offending key (`issue.keys[0]`) so `locate()` can put a line on it.

## The field vocabulary is derived

`packages/song-schema/src/yaml/fields.ts` reads the keys of the zod objects (`Object.keys(schema.shape)`)
to build the completion lists per file kind, and `fileKindFor(path)` names the kind. Adding a field to
a schema makes the editor offer it; there is no second list to keep in step. The one exception is
`WIDGET_FIELDS`, spelled out because the widget schema is a refinement over a base object.

## Timecodes

`packages/song-schema/src/timecode.ts`: `parsePosition` (1-based) and `parseDuration` (0-based) turn
`bar:beat:half:quarter.ticks` into quarter-note beats for a given metre; `beatsToPosition` and
`beatsToDuration` go back, rounding once in ticks (`TICKS_PER_QUARTER = 960`) and dropping trailing
fields at their origin. Chains longer than four fields fall back to the deep rule (each level a
quarter of the previous).

## Tests

`npm test` in the package runs vitest over the `*.test.ts` beside each module. The YAML editors are
tested on literal texts (a round trip must keep comments and quoting); `validate` behaviour is covered
in `packages/song/src/yaml/validate.test.ts` alongside the loader.
