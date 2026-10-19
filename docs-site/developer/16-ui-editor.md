# ui-editor: the text editor stack and autosave

`packages/ui-editor` (`@studio/ui-editor`) is the CodeMirror language stack for song files plus the autosave every text pane runs on. It has no app of its own: k7's editor pane (`apps/k7/frontend/src/components/EditorPane.tsx`, `EditorTab.tsx`), the media library's editor and the module builder use it.

## Exports

| Subpath | File | Holds |
|---|---|---|
| `./k7x/language`, `./k7x/completions` | `src/k7x/` | The k7x language mode for workspace files, and a completion source for field names and values at the cursor's key path. |
| `./yaml/vocabulary` | `packages/ui-editor/src/yaml/vocabulary.ts` | `schemaVocabulary(path, hints)`: turns a file path into a file kind and asks `@studio/song-schema` for that kind's fields and values (Zod introspection), adding project values from the file service's hints (modules to extend, tracks, io sinks). |
| `./k7x/tree` | `packages/ui-editor/src/k7x/tree.ts` | The buffer's k7x tree as a CodeMirror field, kept through a half-typed edit (`packages/ui-editor/docs/k7xTree.md`). |
| `./k7x/entityLinks` | `packages/ui-editor/src/k7x/entityLinks.ts` | Dotted underline on a value naming a file; `Ctrl`/`⌘`-click opens it. Which fields link comes from `hints.paths`, the values from that tree (`k7x/entityValues.ts`). |
| `./k7x/previewGutter` | `src/k7x/previewGutter.ts`, `src/k7x/previewTriggers.ts` | The ▶ audition gutter on lines naming something playable. |
| `./k7x/bufferEdit`, `./buffer-sync` | `src/k7x/bufferEdit.ts`, `src/bufferSync.ts` | A k7x writer run on an open buffer, dispatched as CodeMirror changes so undo and the cursor survive. |
| `./yaml/completions` | `packages/ui-editor/src/yaml/completions.ts` | The YAML completion source, for the médiathèque's own YAML files only. |
| `./faust/language` | `src/faust/language.ts` | Faust highlighting. |
| `./tracker/notes`, `./tracker/plugin` | `src/tracker/` | The tracker and roll note grids. |
| `./lint` | `packages/ui-editor/src/lint.ts` | Draws located findings (line, col, message, severity) as underlines and gutter marks; `refreshLint` re-lints when new findings arrive for an unchanged document. |
| `./autosave` | `packages/ui-editor/src/autosave.ts` | `useAutosave` and the held-buffer store. |
| `./unsaved` | `packages/ui-editor/src/unsaved.ts` | `useUnsavedGuard`: the browser's "leave site?" prompt while any pane holds unsaved work. |

The vocabulary is derived from the schemas rather than tabulated, so completion cannot fall behind the file format.

## How k7 assembles the editor

`EditorPane.tsx` builds the extension list per file kind: vim (`@replit/codemirror-vim`, at `Prec.highest` so basicSetup's keymap does not outrank it) when the preference is on; `Mod-s` and the vim ex command `:w` both call the pane's save; for `.k7x`, the language, schema completion (basicSetup's word completion is turned off so it does not compete), lint from the project's load diagnostics, entity links, the preview gutter and slice colours; for `.strudel`, JavaScript. Extensions are memoised and callbacks held in refs, so typing never reconfigures CodeMirror.

`EditorTab.tsx` keeps **one** editor instance for both the full page and the popin, so the open file, its unsaved text and its undo history cannot fork. It is 1600 lines; the file tree (`FileTree.tsx`) and breadcrumb are already separate, and the toolbar and the file actions are the next things to move out.

## Autosave

There is no Save button: the rule is that a buffer is written as soon as it is a document the compiler could read, and held back, visibly, while it is not.

`decideAutosave({dirty, validity, baselineOk})` is the whole policy, pure:

- clean → nothing;
- valid → write;
- malformed (not parseable) → hold;
- invalid but parseable → hold if the file on disk was valid, **write** if it was already invalid (holding protects nothing then).

`useAutosave` runs it on a 1 s debounce (`AUTOSAVE_DELAY_MS`), validating with `validateFile` from `@studio/song-schema` unless the pane passes its own validator. Its status is `clean | pending | saving | held | error` with a reason; k7 words it in `apps/k7/frontend/src/saveLabel.ts`. Details that matter:

- A held or unwritten text is kept in a module-level map (`keepBuffer` / `recallBuffer`), outside React, so it survives the pane unmounting or switching files.
- The commit where the path changes pairs the new path with the old buffer; nothing is written from it.
- Closing a file flushes it; in `manual` mode (the module builder) closing keeps the draft instead and only `flush()` writes.
- A write in flight never races a second one; text typed during it re-arms the timer.
- `enabled: false` pauses writing (k7 passes it while a disk conflict is being asked about) without dropping the text.
- `flushAutosaves()` lets a host write every pane's pending text before replacing the files under them; it answers false if any pane could not.
- `flush()` is what `Ctrl+S` and `:w` call: "now", not "at all" — it cannot overrule a hold.
- Saving never reformats: the song writers already emit canonical text.

Keeping the buffer in step with disk is k7's `apps/k7/frontend/src/hooks/useDiskSync.ts`: on a `/revision` move it re-reads the open file; a clean buffer adopts the new text outside the CodeMirror undo history; a dirty one raises the "changed on disk" bar (`decideDiskSync` is the pure rule).

## Tests

`npm run test` in `packages/ui-editor`: autosave policy, completion and vocabulary, entity values, preview triggers, the note grids, k7x.
