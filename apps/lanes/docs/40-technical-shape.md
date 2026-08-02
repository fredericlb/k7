# The shape of it

lanes is three processes and a folder of text.

The **folder** is the song: YAML files under a project directory, one entity per file. Nothing is hidden in a binary — a song diffs, merges and greps like source, because it is.

The **file service** (`packages/file-service`) runs on the machine with the audio interface. It owns `~/.lanes/root/<user>/<workspace>`, reads and writes those files, compiles them, and serves the web app over HTTP.

The **engine** is a C++ binary (`engine/`) built on JUCE + Tracktion. It knows nothing about YAML or about files: it receives a compiled `ProjectDoc` as JSON over a WebSocket and plays it.

The **web app** (`web/frontend`) is the only UI. It talks HTTP to the file service for anything on disk, and WebSocket straight to the engine for anything live — transport, meters, plugin parameters. Those two channels are deliberately separate: one is durable state, the other is a 20 Hz feed nobody should persist.

A **tray supervisor** (`engine-tray`, Rust/Tauri) starts and watches the engine and the file service, and publishes the engine's address so a browser can find it.
