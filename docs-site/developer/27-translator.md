# The translator: importing other DAWs' projects

`packages/translator` turns another DAW's project into a k7 project folder. It is a library with no
routes and no UI; the file service is its only caller.

## Shape

```text
.dawproject ──parseDawproject──┐
.als ─────────parseAls─────────┼──► Translation { song, files, stats, warnings } ──emitFolder──► <workspace>/<name>/
.zip (Live) ──parseAlsZip──────┘          (model.ts)                                  (emit.ts)
```

| File | Role |
|---|---|
| `packages/translator/src/model.ts` | The neutral `Song` every importer produces: tracks with role, content type, colour, linear volume, 0..1 pan, mute, plugins, sends and clips; clips with start/length in beats, offset, fades, MIDI loop points, notes, disabled, warp markers. Deliberately no foreign format's model, so the emitter is format-blind. |
| `packages/translator/src/dawproject.ts` | Unzips in memory, parses `project.xml` (fast-xml-parser), maps it onto the model. No disk I/O: it returns the song plus every asset to write. |
| `packages/translator/src/ableton.ts` | The same for a gzipped `.als`, with a `readSample` callback so the caller decides which sample paths may be read. |
| `packages/translator/src/abletonZip.ts` | A zipped "Collect All and Save" folder: picks the one set outside `Backup/` (the shallowest), resolves samples inside the archive, then calls `parseAls`. |
| `packages/translator/src/inflate.ts` | Every unzip and gunzip goes through it, with a ceiling of 1 GiB on what an archive may inflate to, checked against the sizes the archive declares — an import is a file a stranger may upload. |
| `packages/translator/src/params.ts` | Asks the engine binary to enumerate each plugin's parameters, so the module carries diffable text params instead of an opaque preset — kept only when the engine says they reproduce the state. A no-op without an engine binary. |
| `packages/translator/src/emit.ts` | Writes the folder: `project.k7x`, the graph as segments (who feeds whom, which is how sends survive), one module per distinct plugin, nodes where a plugin's settings differ, clips, sequences, and a mixer strip per lane. |

Choices worth knowing before changing it:

- **Lossy on purpose, and loud about it.** Whatever the model cannot carry becomes a line in
  `warnings`: return and group tracks in Live, Session-view clips, un-comped take lanes, Live's
  native devices, rack structure, missing samples, and dropped clips with the reason (a dangling id,
  an id that is not clip content, a clip with nothing in it). The caller prints them in the import log.
- **A mute is a bypass.** A track that arrives muted is written as a bypassed lane, which is where a
  lane's mute lives in k7.
- **Instruments that cannot cross get a stand-in.** A MIDI lane whose instrument did not translate
  (a Live drum rack, say) plays `@k7-core/instruments/k7-rack` for drums or a library synth otherwise,
  and the log says so (`STAND_IN_KIT`, `STAND_IN_SYNTH` in `emit.ts`).
- **Modules land in the workspace's shared modules**, and names already used there are avoided, so an
  import never silently reuses or shadows another song's module of the same name.
- **Send levels are lost** in the graph's segments: a weighted send arrives at full level, with a
  note in the project.
- Unwarped audio counts its in-point in seconds in DAWproject; the model counts beats. That
  conversion is the most fragile line in `dawproject.ts` and is pinned by its tests.

## The caller

`packages/file-service/src/projectLifecycle.ts`:

- `IMPORTABLE` (`.dawproject`, `.als`, `.zip`) — what the file tree may import;
  `DROPPABLE` (`DROPPABLE_PROJECTS` in `packages/web-protocol/projects.ts`: `.dawproject`, `.zip`) —
  what may be dropped, since a lone `.als` names its samples by path and must sit beside them.
- `translateInto` parses, picks a fresh top-level folder (the file's stem, `-2`, `-3`… when taken; a
  name somebody typed is refused if occupied rather than changed), resolves plugin params, emits, and
  returns `{ project, log }`.

Two routes call it (`packages/file-service/src/routes/files.ts`): `POST /import-project` for a file
already in the workspace, `POST /import-upload` for a dropped file's raw bytes, which are translated
and never written into the workspace.

In the editor, a click on such a file in the tree (`EditorTab.tsx`'s `open`) or `project import <path>`
opens the two-phase dialog of `apps/k7/frontend/src/hooks/useProjectDialogs.ts` and
`apps/k7/frontend/src/components/ImportDialog.tsx`: confirm runs the import and shows the log; **Open project** then
activates the result. The drop on a workspace row belongs to the home page
(`apps/k7/frontend/src/projects/`).

## Tests

`packages/translator/src/dawproject.test.ts`, `ableton.test.ts`, `abletonZip.test.ts` and
`emitNodes.test.ts` build small projects in memory and assert on the model and on the emitted files;
`packages/file-service/src/importDrop.test.ts` covers the drop route's refusals and naming.

## See also

- [Rendering, export and bouncing](./26-render-process-code.md)
