# k7 developer guide

This guide is for contributors to the k7 codebase. It says where each part of the code lives, how
data travels between the browser, the server, the per-account file services and the engine, and
how to extend each area. Sections share their numbers with the [user guide](../user/00-index.md),
so the user-facing page for a feature sits at the same number.

New to the repository? Read [Repository layout](./01-repository-layout.md),
[Architecture overview](./02-architecture.md) and [Dev setup](./03-dev-setup.md), then follow the
edit path in [The edit path](./21-edit-path.md).

## Repository, tooling and delivery

- [Repository layout](./01-repository-layout.md)
- [Architecture overview](./02-architecture.md)
- [Dev setup and `npm run dev`](./03-dev-setup.md)
- [Root npm scripts](./04-npm-scripts.md)
- [Tests](./05-tests.md)
- [Lints and conventions](./06-lints-and-conventions.md)
- [CI](./07-ci.md)
- [Images, deployment and versioning](./08-images-and-deployment.md)
- [Releases and publishing](./09-releases-and-publishing.md)

## Frontend shell, commands and backend

- [k7 frontend architecture](./10-frontend-architecture.md)
- [project-shell](./11-project-shell.md)
- [The commands package](./12-commands-package.md)
- [Adding a command](./13-adding-a-command.md)
- [Keys, the palette and the right-click menu](./14-keys-palette-menus.md)
- [Translation (paraglide)](./15-i18n.md)
- [ui-editor: the text editor stack and autosave](./16-ui-editor.md)
- [Shared UI packages: user menu and mini player](./17-shared-ui-packages.md)
- [The k7 backend server](./18-backend-server.md)
- [Frontend and backend boundary](./19-frontend-backend-boundary.md)

## Arrangement

- [Arrangement code: where it lives](./20-arrangement-map.md)
- [The edit path](./21-edit-path.md)
- [The timeline component](./22-timeline-component.md)
- [Clip and note editors, and curves](./23-clip-editors-code.md)
- [MIDI, recording and takes](./24-recording-code.md)
- [Mixer, meters and mastering](./25-mixer-mastering-code.md)
- [Rendering, export and bouncing](./26-render-process-code.md)
- [The translator](./27-translator.md)
- [Testing the arrangement code](./28-arrangement-tests.md)
- [Extending: a new arrangement gesture or verb](./29-extending-arrangement.md)

## The song pipeline and the disk

- [The song pipeline](./30-song-pipeline.md)
- [song-schema: the file format](./31-song-schema.md)
- [The compiler: packages/song](./32-song-compiler.md)
- [song-edit: surgical writes](./33-song-edit.md)
- [k7x: the text format](./34-k7x.md)
- [song-strudel: pattern lanes](./35-song-strudel.md)
- [file-service: one process per account](./36-file-service.md)
- [file-hub: workspaces, libraries and the sync relay](./37-file-hub.md)
- [live-sync: edits as operations](./38-live-sync.md)
- [Adding a field or a file kind](./39-adding-a-field.md)

## Chains, modules and plugins

- [Chains graph: architecture](./40-chains-architecture.md)
- [graph-model and ui-chains](./41-graph-model-and-ui-chains.md)
- [ui-chains-react: the renderer](./42-ui-chains-react.md)
- [The module builder](./43-module-builder.md)
- [Panels and their checkers](./44-panels-and-checkers.md)
- [Libraries, module refs and assemblies](./45-libraries-and-resolution.md)
- [The plugin contract (k7-sdk)](./46-k7-sdk.md)
- [k7's builtin plugins (k7-plugins)](./47-k7-plugins.md)
- [DSP written in TypeScript (packages/dsp)](./48-dsp.md)
- [The engine's plugin catalogue](./49-engine-catalogue.md)

## Picture

- [The picture pipeline: architecture](./50-picture-architecture.md)
- [song-video: the picture compile](./51-song-video.md)
- [ui-eyes: the WebGL compositor](./52-ui-eyes.md)
- [The viewport plugin and the frontend's picture code](./53-viewport-and-frontend.md)
- [Picture commands and media preparation](./54-picture-commands.md)
- [Server render: `picture render`](./55-server-render.md)
- [Extending the picture, and testing it](./56-extending-and-testing.md)

## DJ desk, playlists and references

- [The DJ desk: architecture](./60-turntables-architecture.md)
- [Desk controls and bindings](./61-turntables-bindings.md)
- [Desk timing: analysis, tempo, sync, loops, cues](./62-turntables-timing.md)
- [Playlists and reference tracks: code](./63-playlists-references.md)
- [Stem separation and transcription](./64-stems-transcription.md)
- [DJ side: tests and measurements](./65-dj-tests.md)

## Media library and rehearsal recorder

- [Overview](./70-media-and-rehearsal-overview.md)
- [The mediatek package](./71-mediatek.md)
- [Media backend routes](./72-media-backend.md)
- [The media library screens](./73-ui-library.md)
- [The rehearsal server](./74-rehearsal-server.md)
- [The rehearsal screens](./75-ui-rehearsal.md)
- [Recorder, lyrics, tablature, score](./76-rehearsal-libraries.md)
- [Testing and extending the media and rehearsal code](./77-media-testing.md)

## Engines

- [Engine architecture](./80-engine-architecture.md)
- [The C++ engine (`engine/k7-runtime`)](./81-k7-runtime.md)
- [The supervisor (`engine/k7-supervisor`)](./82-k7-supervisor.md)
- [The engine protocol](./83-engine-protocol.md)
- [Engine clients](./84-engine-clients.md)
- [Registry and tunnel](./85-registry-and-tunnel.md)
- [The tray and the phone apps](./86-desktop-and-android.md)
- [Building and shipping engines](./87-engine-build-and-shipping.md)
