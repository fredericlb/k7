# What happens when you press play

- The web app asks the file service for the project.
- `song` parses the folder, validates each file against its schema, resolves `extends` and nodes, and compiles a ProjectDoc.
- The file service sends it to the engine over the WebSocket.
- The engine builds a Tracktion edit and **instantiates every plugin** — this is the slow part, seconds on a song with several VST3s, and it blocks its message thread.
- Transport commands, meters and plugin parameters then flow over that same socket at frame rate.

An edit made in the UI takes the short way round: the command rewrites one value of a k7x file, the file service recompiles, and the engine receives a *diff* rather than a rebuild — which is why moving a fader doesn't reload your plugins.
