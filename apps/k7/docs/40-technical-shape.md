# The shape of it

k7 is a folder of text, a service that reads it, and an engine that plays it.

The **folder** is the song: YAML files under a project directory, one entity per file. Nothing is hidden in a binary — a song diffs and greps like source, because it is. Projects live in **workspaces**, folders on the server that k7 keeps in step, live, on every device you open them on.

The **file service** (`packages/file-service`) runs on the server, one per account, started by k7's server. It owns the account's workspaces, reads and writes their files, compiles them, and answers the web app over HTTP.

The **engine** is a C++ binary (`engine/k7-runtime`) built on JUCE + Tracktion, running on the machine with the audio interface. It knows nothing about YAML or about files: it receives a compiled `ProjectDoc` as JSON over a WebSocket and plays it. It is not k7' engine in particular — it is the machine's, and any app that can produce a `ProjectDoc` can drive it.

The **supervisor** (`engine/k7-supervisor`), beside it, starts and watches the engine, keeps it listed at the studios it is connected to, and holds the tunnel a server reaches the machine through. It runs from the command line with a config file, or inside the desktop app and the Android app, which drive it over its standard input and output.

The **web app** (`apps/k7/frontend`) is k7' UI. It talks HTTP to the file service for anything on disk, and a WebSocket to the engine for anything live — transport, meters, plugin parameters — directly when the browser may reach the machine, relayed through the server otherwise. Those two channels are deliberately separate: one is durable state, the other is a 20 Hz feed nobody should persist.
