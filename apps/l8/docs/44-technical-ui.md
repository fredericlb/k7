# ui-chains / ui-editor / ui-eyes — the three view engines

Framework-agnostic packages the web app draws with:

- **ui-chains** compiles a GraphDoc to a dagre layout — node boxes, routed cables — which the app renders as HTML nodes and an SVG cable layer.
- **ui-editor** is the CodeMirror stack: the YAML mode, completions derived from the entity schemas, and the sequence tracker's note grid.
- **ui-eyes** composites the song's video lanes onto its viewport with WebGL, in real time against the playhead or frame-by-frame to a file. It knows nothing about audio: it takes a scene and a clock.
