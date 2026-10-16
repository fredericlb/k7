# The commands package

`packages/commands` (`@studio/commands`) is k7's one verb list. Every action a person can take on a song — from the command bar, a key, a button, a right-click — is a line dispatched through it. The web editor has no file operations of its own: the file service runs the verbs.

## Pieces

| File | Role |
|---|---|
| `packages/commands/commands.yaml` | The **catalogue**: what you type, mapped to a feature SID, with its description, arguments and menus. Declarative. |
| `packages/commands/src/commandSpec.ts` | Loads the catalogue, holds the completion **providers**, validates argument shapes, completes, dispatches (`runCommand`), and registers plugin verbs. |
| `packages/commands/src/commands.ts` | `SID_HANDLERS`: SID → handler, the `CommandHost` interface, and many handlers. |
| `packages/commands/src/verbs/` | Handler families (`TRACK_VERBS`, `PICTURE_VERBS`, `SYSTEM_VERBS`…), spread into `SID_HANDLERS`. |
| `packages/commands/src/testHost.ts` | A host for tests. |

The work a verb does lives in other packages: `@studio/song-edit` changes project files, `@studio/take-render` writes audio, `@studio/audio-passes` runs offline chains. A handler parses its arguments, calls them, and reports.

## A catalogue entry

```yaml
- command: "track order"
  sid: track.order
  readable:
    en: "Move a track to another position"
    fr: "Déplacer une piste à une autre position"
  help: "put a track at a position (e.g. track order gtr 2) — 1 is the top, past the end is the bottom"
  surfaces: [cli]
  menu: [track]
  args:
    [
      { name: track, complete: tracks },
      { name: position, hint: "1-based, counting lanes from the top" },
    ]
```

| Field | Meaning |
|---|---|
| `command` | The words typed. Dispatch picks the **longest** command that prefixes the line, so `track duplicate empty` is not shadowed by `track duplicate`. |
| `sid` | The stable feature id the handler is registered under. |
| `readable` | One imperative sentence per language (`en`, `fr`), no example, no full stop, 60 characters at most. The palette lists and fuzzy-matches on it. Both languages are required. |
| `help` | The fuller line with an example; shown on the help page. |
| `surfaces` | Only `cli` exists; the web dispatches under it too. Absent means everywhere. |
| `menu` | Which right-click menus may offer it: `track`, `group`, `node`, `event`, `param`, `curve`, `ruler`, `marker`, `assembly`, `warp`, `shot`, `pad`, `note`, `tap` (`MENU_ENTITIES`). Absent means every menu whose click answers the command's leading arguments; write it only to **narrow**. Unknown words are reported and dropped. |
| `confirm` | `true` makes the right-click ask before running (used by `track delete`). |
| `args[]` | Trailing arguments: `name`, and **either** `complete: <provider>` (values from the live project) **or** `values: [...]` (a closed set); `type: timecode \| number \| note` to shape-check a single-token argument before the handler runs; `hint`; `optional: true` (trailing only). An argument that swallows the rest of the line (a message, a name with spaces, JSON) carries no `type`. |

## Providers

`PROVIDERS` in `commandSpec.ts` answer `complete:` names from the `CommandHost`: `tracks`, `nodes`, `modules`, `baseModules`, `engineModules`, `categories`, `curves`, `sequenceFiles`, `audioFiles`, `clipTargets`, `chains`, `samples`, `markerNames`, `moduleAlternatives`, `moduleEngines`, `assemblies`, `assemblyTemplates`, `playlists`, `libraries`, `pictureLanes`, `surfaceTypes`. The map is typed `satisfies Record<string, …>`, so `ProviderName` follows it and a stale reference stops compiling; an unknown name in the YAML is reported at load and fails the test suite rather than emptying the catalogue.

Each provider also declares a **display class** (`PROVIDER_CLASS`: track, module, file, marker, choice…) and a default hint (`PROVIDER_HINT`). The class colours the palette's field; `CLASS_HINT` supplies the hint of scalar classes (`timecode` → "bar:beat:sixteenth — 5, 5:1, 5:1:1"). `PROVIDER_LABELS` lets a provider show a readable label for a value that is not readable (a chain project's node uuid shown as its module and place).

## Dispatch

`runCommand(line, host, surface)`:

1. picks the spec by longest prefix; none is a refusal `unknown command`;
2. finds the handler in `SID_HANDLERS`;
3. validates typed arguments positionally (`validateArgs`) — a malformed timecode is refused with what it should look like;
4. refuses an event verb aimed at a lane that only plays a picture's sound (`soundingLaneRefusal`);
5. calls the handler with the raw argument string and the host.

A handler **refuses** through `host.refuse(lines)` and returns: a refusal is not an error, nothing is written, and the web shows it in amber. It reports through `host.log(lines)`.

## The host

`CommandHost` (in `commands.ts`) is everything a verb may touch: the song path and compiled `ProjectDoc`, `log` / `refuse`, `reload`, the transport, `arm`, applying the project to the engine, plugin listing and scanning, and optional capabilities (`getAudioDevices`, `clipEnvelope`, `runColdStep`, `onnxProviders`, `saveTake`, `fetchLibraryVersion`, `renderer`, `snapshot` for undo backups, `repoDir` for workspace-wide files…). Optional members are absent on hosts that cannot provide them, and the verb refuses with the reason.

The production host is `makeHost` in `packages/file-service/src/engineLink.ts`. `runWebCommand` there wraps every run in the workspace's change journal (`recordChange`) so it is one undo step, returns the output, the revision before and after, the files written and, when asked, the graph built after the write. Verbs that need no active project (`system channel`, `playlist`, `library`) are listed in `GLOBAL_COMMAND`; every other one is refused without an open project.

The file service exposes:

| Route | Answers |
|---|---|
| `GET /commands` | The catalogue for the palette (`webCommandList`): command, help, readable, menu, confirm, and each argument's class, provider and hint. |
| `GET /complete?line=` | `completionItems` for a partial line (with `labels=1`, labelled items). |
| `POST /command` | `{line, at?, want?}` → output, `refused`, revision, changed files, and the graph when `want` includes it. |

All three are in `packages/file-service/src/routes/files.ts`.

## Plugins add verbs

A plugin (`packages/k7-sdk`) contributes a command as a spec **and** a handler together: `registerVerb` in `commandSpec.ts` calls `registerCommandSpec` and `registerCommand`, and both refuse a word or SID already taken. `installServerSide` in `packages/k7-sdk/src/install.ts` records which plugin owns which SID. The file service installs the builtin plugins at boot (`installBuiltinPlugins` from `packages/k7-plugins/src/server.ts`); today that is the transcription plugin's `track transcribe` (`packages/k7-plugins/src/transcription/index.ts`). Registered specs are merged into every read of the catalogue, so palette, menus and dispatch see them like YAML rows.

## Web-local commands

Some lines are answered by the browser, not the file service, because what they do only exists there. They are listed in `apps/k7/frontend/src/palette.ts` (`LOCAL_COMMANDS`, with `LOCAL_READABLE` and `LOCAL_ARGS`) and dispatched by `runLocalCommand` in `App.tsx`:

- **`ui …`** — view state only: never the project, never the transport. `apps/k7/frontend/src/localCommands.ts` holds the exact names (`UI_EXACT`) and heads (`UI_HEADS`); the prefix is enforced both ways (`uiVerdict`). An unprefixed line that the server's catalogue names goes to the server even if it shares a word with a `ui` head (`curve set` is not `ui curve set`).
- **The bare transport verbs** (`BARE_TRANSPORT`: play, stop, toggle, rewind, panic) go straight down the engine socket for latency, falling through to the file service when the socket is down or busy. `transport replay`, `locate`, `loop`, `record`, `step next/prev` are browser-only.
- **The selection verbs** (`selection copy/paste/delete/split`) read the clipboard and the rectangle, which are the browser's, and emit catalogue lines (`events add`, `events remove`, `event split`…).
- **Writes through a route rather than a verb**: `project undo/redo`, `project export`, `project share k7/link`, `project import`, `project master fix`, the file tree's `fs file …` / `fs folder new`, `module create rack`, `sequence edit roll/tracker`.

`localCommands.test.ts` holds the palette's list against the dispatcher, so no command lists and then does nothing.

## Tests

`npm run test` in `packages/commands`. `commandSpec.test.ts` checks the catalogue itself: every provider exists, every typed argument is a known single-token shape, every class and menu word is mirrored on the wire, every argument has a hint, and `readable` exists in both languages, is a sentence rather than the name, fits 60 characters, has no full stop, and is unique. Each verb family has its own test file over `testHost.ts`.
