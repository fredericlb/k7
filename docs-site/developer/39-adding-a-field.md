# Adding a field or a file kind

This page is the checklist for extending the song format end to end. Each step names the file to
touch and what forgetting it costs.

## Adding a field to an existing file kind

Take, as an example, a new optional number on a lane's event.

1. **Schema.** Add it to the zod schema in `packages/song-schema`: here `PlacementSchema` in
   `packages/song-schema/src/yaml/placementSchema.ts`. Module, node and lane fields go in
   `MODULE_FIELDS` in `packages/song-schema/src/yaml/moduleSchema.ts` (shared by modules and their
   alternatives); project fields in `ProjectSettingsSchema` or `ProjectFileSchema`; clips, sequences,
   curves and picture lanes in `packages/song-schema/src/yaml/entitySchemas.ts`. Schemas are strict:
   until this step, the field is refused with `Unrecognized key`.
   Give it bounds and a message that names the expected spelling; the message is what the user reads.
2. **Completion comes for free.** `packages/song-schema/src/yaml/fields.ts` reads the schema's keys, so
   the editor offers the field. Only a widget field must be added by hand to `WIDGET_FIELDS`.
3. **Timecodes.** If the value is a timecode, add its key to `TIMECODE_KEYS` in
   `packages/song-schema/src/yaml/placementSchema.ts`, so every writer quotes it.
4. **Keyed lists.** If the field is a list whose items should sync as items, give it key fields in
   `LIST_KEYS` (`packages/live-sync/src/listKeys.ts`); otherwise a concurrent edit to one item replaces
   the whole list.
5. **Inheritance.** For a module field, decide how it merges: by default the child's value replaces
   the parent's. A map that should merge per key needs a case in `mergeAuthored`
   (`packages/song/src/moduleResolve.ts`); a field a node must never inherit goes in `OWN_ONLY`.
6. **Compile.** Read the field in the compiler — for events and modules, in
   `packages/song/src/nodeProject.ts` — and, if the engine needs it, add it to the wire type in
   `packages/engine-protocol/project.ts`. The engine mirrors those types in C++ and diffs documents, so
   a new wire field must always be sent (with its default) and must be handled on the engine side
   (see the engine section).
7. **Cross-file checks.** If the field names another file or node, check it with the other reference
   checks in `nodeProject.ts` and throw with a message naming the lane and the target. If it names a
   path, pass it through `confineTo`/`projectRoots` (`packages/song/src/confine.ts`): every file
   service runs as the same OS user, so a `../` is another account's file.
8. **Writer.** If k7 changes the field, write a text transform in the kind's `*File.ts`
   (`packages/song-schema/src/yaml/`) or a writer in `packages/song-edit/src/`, delete the key when it
   returns to its default, and expose it as a verb in `packages/commands`. Never re-serialise a whole
   document: comments and other values must stay byte for byte, or live sync falls back to whole-text
   operations.
9. **Tests.** A schema case beside the schema; a writer test that compares text; a compile change shows
   in the golden snapshot `packages/song/src/project.golden.test.ts` — update the snapshot in the same
   commit. If a demo uses the field, `packages/live-sync/src/corpus.test.ts` and
   `packages/k7x/src/corpus.test.ts` check that edits to it replay.
10. **Docs.** Add the field to the user guide's song file reference with its type, default and an
    example.

## Adding a file kind

1. **Folder and schema.** Name the folder (a constant beside the schema, as `CHAINS_DIR` or
   `ASSEMBLIES_DIR`) and write its schema in `packages/song-schema/src/yaml/`. A file is named by its id;
   never add an `id:` field inside it.
2. **Validation.** Route it in `parserFor` (`packages/song-schema/src/yaml/validate.ts`). Order
   matters: the router tests folders first, then basenames. Without this the editor checks syntax
   only.
3. **Completion.** Add a kind to `fileKindFor` and `fieldsAt` in
   `packages/song-schema/src/yaml/fields.ts`.
4. **k7x short form**, if one is wanted: a `SugarPart` in `packages/song-schema/src/yaml/sugar.ts`,
   returned by `sugarFor(path)`. It must expand to plain data the schema already accepts.
5. **Loader.** Read it in `packages/song/src/loader.ts` — a flat folder of entities can be added to
   `ENTITY_SCHEMAS` and read through `readYamlEntities`/`exportSub`; an optional folder with its own
   reader follows `packages/song/src/surfaces.ts` or `assemblies.ts`. Always go through
   `packages/song/src/yaml/workspaceFile.ts` (`wsRead`, `wsList`, `wsWrite`) so `.k7x` files work.
6. **Diagnostics.** Decide whether a broken file stops the compile (a thrown error) or is reported as a
   `Diagnostic` and skipped. A drawing aid (surfaces, assemblies) should not stop the music.
7. **Layout migration.** If the file names nodes by name, `migrationBlocker`
   (`packages/song/src/chainsMigrateFiles.ts`) must refuse to convert a project holding it, since a
   chain project renames non-lane nodes to ids.
8. **File service.** `.yaml`/`.k7x` files already move the revision token, are journalled by
   `recordChange` and synced by live capture. Add a route in `packages/file-service/src/routes/files.ts`
   only if the browser needs a derived view of the new kind.
9. **Scaffold.** If new projects should have one, add it to the archetype's file map in
   `packages/song/src/scaffold.ts`, `scaffoldSet.ts` or `scaffoldLive.ts`, with comments: the
   scaffolded file is the user's first example of the format.

## Running the checks

```bash
npm test --workspace @studio/song-schema
npm test --workspace @studio/song
npm test --workspace @studio/song-edit
npm test --workspace @studio/live-sync
npm run lint
```
