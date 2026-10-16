# The song pipeline

A k7 song is a folder of text files. This section covers the code between those files and the
engine: the schemas that define them, the compiler that turns them into the document the engine
plays, the writers that change them one value at a time, the text format they are moving to, and
the per-account process that serves them.

| Page | Package(s) |
|---|---|
| [The pipeline](./30-song-pipeline.md) | overview |
| [song-schema](./31-song-schema.md) | `packages/song-schema` — the file format, browser-safe |
| [The compiler](./32-song-compiler.md) | `packages/song` — loader, inheritance, compile |
| [song-edit](./33-song-edit.md) | `packages/song-edit` — surgical writes |
| [k7x](./34-k7x.md) | `packages/k7x` — the parser, the editor, the bridge to YAML |
| [song-strudel](./35-song-strudel.md) | `packages/song-strudel` — pattern lanes |
| [file-service](./36-file-service.md) | `packages/file-service` — the per-account process and its HTTP API |
| [file-hub](./37-file-hub.md) | `packages/file-hub` — spawning file services, libraries, the sync relay |
| [live-sync](./38-live-sync.md) | `packages/live-sync` — operations and their order |
| [Adding a field or a file kind](./39-adding-a-field.md) | end-to-end recipe |

## Data flow

```text
 browser editor ──PUT /file──▶ file-hub ──proxy──▶ file-service (one per account)
   │  validateFile()                                 │ Workspace.recordChange → journal
   │  (song-schema, in the browser)                  │ revision token moves
   │                                                 ▼
   │                                     @studio/song loadProject(dir)
   │                                       loader → resolve extends → compile
   │                                                 │
   │                                                 ▼ ProjectDoc (engine-protocol)
   │                                     engineLink: sync files to the engine's machine,
   │                                     sendProject over WebSocket, warm up
   │
   └──GET /graph, /project-doc, /project-errors◀── WebGraph / WebProject / diagnostics
```

- **The engine never parses song files.** It receives a compiled `ProjectDoc`
  (`packages/engine-protocol/project.ts`) with absolute paths, diffs it against what it holds, and
  plays. Everything about folders, inheritance and YAML lives in TypeScript.
- **The browser validates what the compiler would read**, with the same zod schemas, before the
  buffer is written. That is why `@studio/song-schema` has no `node:` import, and why
  `@studio/song` (which reads disks) is a separate package.
- **Writes are surgical.** A knob drag or a timeline drag changes one value in one file and keeps
  every comment and every other byte, so a change is a one-line diff and the live-sync layer can
  express it as a key-path operation.

## The split between packages, and what forced it

| Package | May import `node:`? | Why it is separate |
|---|---|---|
| `song-schema` | no | The browser's text panes, the note grids and the desk need the schemas and the small pure modules (timecode, playlist, stems…) without pulling in a filesystem. |
| `k7x` | no | The browser edits `.k7x` buffers; the parser must run there. |
| `song` | yes | The loader walks the project, the shared `_modules/`, the account's libraries; the compile resolves absolute paths. |
| `song-edit` | yes | Writers that change a project: they read the files a name lives in and rewrite them. |
| `song-video` | yes | The same folder compiled to its picture document. Documented in the Picture section. |
| `song-strudel` | no | Bundled into the engine; nothing imports it at run time. |
| `file-service` | yes | A process: one per account, serving one account's workspaces. |
| `file-hub` | yes | Mounted by k7's backend: starts the file services and owns what is shared between accounts. |
| `live-sync` | no | The ordering rules; used by the hub's rooms and by every replica. |

All of them are consumed as raw TypeScript through `package.json` `exports` subpaths; a deep import
outside those subpaths fails on purpose.
