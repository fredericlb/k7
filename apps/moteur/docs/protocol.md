# The engine's WebSocket protocol (`server/main.cpp`)

`lanes-engine` is a headless audio server: a thin WebSocket bridge over
`lanes::engine`, speaking JSON. The engine does not parse files — the Node brain
interprets the song, resolves clip paths to absolute, and sends the project as JSON.

`main.cpp` includes **no** JUCE or Tracktion headers: all engine threading sits behind
`EngineHost`'s `post()` / `onState()` / `run()` API.

## client → server

| message | meaning |
|---|---|
| `{ type: "project", doc: {…ProjectDoc…} }` | set or update the song |
| `{ type: "flush" }` | forget the song entirely |
| `{ type: "transport", action: "play" \| "stop" \| "toggle" \| "rewind" }` | bare transport verbs |
| `{ type: "transport", action: "seek", position: 12.5 }` | seconds |
| `{ type: "transport", action: "loop", start: 4, end: 8, enabled: true }` | loop region, in seconds |
| `{ type: "preview", file: "/abs/kick.wav", start: 0, length: 0 }` | audition a sample |
| `{ type: "watch-plugin-params", id: "chain:module", on: true }` | follow a plugin's values live |
| `{ type: "subscribe-waveform", id, side: "input"\|"output", trackIndex }` | tap a module's audio |
| `{ type: "unsubscribe-waveform", id, side }` | drop that tap |
| `{ type: "list-presets", module: "synth" }` | → a `presets` reply |
| `{ type: "set-preset", module: "synth", index: 3, path: "" }` | pick a preset |
| `{ type: "list-edit-plugins" }` | → an `edit-plugins` reply |
| `{ type: "show-native-plugin-ui", id: "chain:module" }` | open the plugin's own window |

## server → client

| message | meaning |
|---|---|
| `{ type: "applied", changes: ["tempo -> 124 bpm", …] }` | the diff that ran |
| `{ type: "flushed" }` | flush completed |
| `{ type: "state", playing, playhead, levels, inputLevels, waveform }` | the ~20 Hz state frame |
| `{ type: "plugin-params-live", id, params }` | the watch feed, while a value moves |
| `{ type: "plugin-params", id, params, meta }` | the state to persist; `meta` only on the get- reply |
| `{ type: "presets", module, presets: [{name,source,index,path}, …] }` | |
| `{ type: "edit-plugins", plugins: [{id,name,hasNativePluginUI}, …] }` | what the loaded project holds |
| `{ type: "busy", busy: true\|false }` | the message thread is (un)blocked by an apply |
| `{ type: "error", message }` | |
