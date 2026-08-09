# Is this text a file the compiler can read?

`yaml/validate.ts` answers that about a **buffer**, in a browser, for any file a project is made
of. It exists because the editors autosave now
([packages/ui-editor/docs/autosave.md](../../ui-editor/docs/autosave.md)) and something has to
decide whether the text in the pane is worth writing.

It adds no schema of its own. Every file kind here already had a parser — `parseModule`,
`parseUiFile`, `parseTrack`, `parseChains`, `parseSongs`, `parseMixView` — all with the same
shape, `{ value, issues }`, all returning located findings, all browser-safe. This is a
**router** over them, plus a plain Zod check for the kinds that have no parser of their own
(clips, sequences, curves, video tracks, `project.yaml`, and a module folder's shelf and MIDI
map).

Because it is the loader's own parsers, an editor and a compile cannot disagree about whether a
file is readable. That is the whole reason it is not a second, simpler check written next to the
editor.

## What a path is read as

By folder and basename, the way `fileKindFor` reads one:

| path | read as |
|---|---|
| `modules/**/ui.yaml` | the panel (`UiFileSchema`) |
| `modules/**/presets.yaml` | the shelf |
| `modules/**/controller.yaml` | the MIDI map |
| `_modules/config.yaml` | a library's namespace |
| `modules/**/*.yaml` — anything else | a module, generic or instance (`ModuleSchema`) |
| `instances/*.yaml` | a module, again — the project's flat instances folder |
| `tracks/`, `clips/`, `sequences/`, `curves/`, `video_tracks/` | that kind's schema |
| `chains.yaml`, `project.yaml`, `songs.yaml`, `views/mix.yaml` | the root files |
| any other `.yaml` | parsed, not judged |
| anything not YAML | not this module's business |

`_modules` is matched as well as `modules`: a shared library holds the same files, and editing
one is what forks it.

The module folder's split — which basenames are the module ITSELF and which are a use of it —
belongs to `yaml/moduleIO.ts`, which cannot be imported here because it reads the disk. So the
two are **pinned by a test**: add a sibling file there without adding it here and
`validate.test.ts` fails, rather than the file being silently read as an instance.

## Three depths, and why the caller cares

`Validity` says how far the check could go:

- `schema` — parsed and checked. `ok` means the loader would accept it.
- `syntax` — parsed; no schema claims this path. `ok` means only that it is YAML.
- `none` — not YAML at all. Nothing here can judge it, so it says nothing.

**A file this doesn't recognise is `ok`.** Silence is not a verdict, and an autosave that
refused everything it had no opinion about would refuse the médiathèque's own files.

`malformed` is separate from `ok` for the same reason: "does not parse" and "parses but says
something the schema refuses" are different answers to a caller deciding whether to write, and
autosave treats them differently. Getting that distinction exact is why the text is parsed
twice — once for syntax, once by the kind's parser — which costs nothing at these sizes.

## Where the line and column come from

The same `locate` the module parser uses, now exported from `moduleFile.ts`: walk the YAML
document to the deepest node on the issue's path and read its range through a `LineCounter`. An
unknown key is reported by Zod against its *containing* object, so the key is appended to the
path before locating — otherwise every typo would point at the top of the file.

That is what lets an editor underline the reason it is not saving, instead of only naming it in
a toolbar.
