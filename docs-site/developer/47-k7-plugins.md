# k7's builtin plugins (k7-plugins)

`packages/k7-plugins` holds the feature plugins k7 ships and the two lists that compose them. The
contract they implement is the previous page, [The plugin contract](./46-k7-sdk.md).

## The two composition lists

A plugin has up to two halves, installed in two processes:

| List | File | Installed by | When |
|---|---|---|---|
| `BUILTIN_PLUGINS` | `packages/k7-plugins/src/server.ts` | `installBuiltinPlugins()`, called by the file service (`packages/file-service/src/server.ts`) | At boot, so every account's file service knows the plugin's verbs and surface types before it answers `/command` or `/complete`. |
| `BROWSER_PLUGINS` | `packages/k7-plugins/src/browser.ts` | `apps/k7/frontend/src/plugins.ts`, through `builtinBrowserPlugins()` | When the shell loads, registering each plugin's panes in the pane ring. |

Why two lists rather than one: commands run in the file service (Node), panes in the browser.
Importing a pane's React tree into the file service, or a verb's filesystem code into the
browser bundle, would be wrong in both directions, so each process imports only its list.

`packages/k7-plugins/src/composition.test.ts` installs the server list into the real registries
and checks every browser plugin contributes a pane.

## The plugins

| id | List | Folder | Contributes |
|---|---|---|---|
| `transcription` | server | `packages/k7-plugins/src/transcription/` | The verb `track transcribe <track_in> <track_out>` (sid `track.transcribe`, on the track menu). It decodes the audio of the video a picture lane places with ffmpeg, runs `whisper` (openai-whisper) or `whisper-cli` (whisper.cpp, which needs `STUDIO_WHISPER_MODEL` naming a ggml model), and writes the SRT as the new lane's `content:`. |
| `turntables` | browser | `packages/k7-plugins/src/turntables/` | The pane for the `turntables` surface type: the DJ desk. The surface type itself is a schema built-in, so the plugin registers no type. |
| `video` | browser | `packages/k7-plugins/src/video/` | The pane for the `viewport` surface type: the WebGL picture window. |

The desk and the viewport are documented in the DJ and picture sections of this guide; this page
covers only how they plug in.

### Package exports

| Export | File | Used by |
|---|---|---|
| `./server` | `src/server.ts` | the file service |
| `./browser` | `src/browser.ts` | the k7 shell |
| `./video` | `src/video/index.ts` | `videoPlugin`, plus `sceneOf`, `ViewportPane` and `ViewportTab` for the shell's export flow |
| `./video/sceneFrom` | `src/video/sceneFrom.ts` | building a picture scene outside the pane |
| `./video/camera/relay` | `src/video/camera/relay.ts` | the camera relay |
| `./turntables/engine` | `src/turntables/engine.ts` | the desk's engine-facing half |

### Scripts

`packages/k7-plugins/scripts/turntables/put-on.ts` is a WebSocket benchmark that measures what
putting a record on a deck costs against a running engine (`npx tsx` with the engine's address,
`--minutes`, `--runs`, `--hold`). It is a measuring tool, not part of any test run. Its import of
`../src/deck` does not resolve from the script's own folder (the module is
`packages/k7-plugins/src/turntables/deck.ts`), so it fails to start until that path is fixed.

## Adding a plugin

Follow the steps in [The plugin contract](./46-k7-sdk.md#writing-a-plugin): a folder under
`src/`, an `index.ts` exporting `definePlugin({...})`, and an entry in one or both lists. Then:

```bash
npm test -w @studio/k7-plugins
npm test -w @studio/k7-sdk
```

A pane needs its surface type known to the browser's surface registry when the shell registers
it. `installServerSide` registers surface types in the file service only, so today a pane can only
draw a schema built-in type (`timeline`, `viewport`, `turntables`, `mastering`).
