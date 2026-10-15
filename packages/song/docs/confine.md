# confine.ts — where a path a song file names may lead

A song file is text, and the text names files: a clip's `source:`, a rack tap's `clip:`, a Faust
slot's sound, a module's `frozen:` render, a chain item's `vstpreset:`. On the server **every
account's file service runs as the same OS user over one data root** (`$STUDIO_FILES_ROOT`, one
folder per account — `packages/file-hub/docs/fileHub.md`). The operating system therefore stops
nothing: a `../../bob/workspace/…` in Alice's clip file is Bob's recording, and whatever reads,
copies, decodes or deletes it does so for Alice. So every such path goes through ONE check,
`confineTo(roots, path)`, before anything touches it.

## The check

- The path is resolved to an absolute one; a NUL byte refuses it outright.
- It must be a root itself or lie under one, by whole segment (`/a/song-evil` is not under `/a/song`).
- The nearest part of it that exists on disk is followed through its symlinks, and its real path
  must again lie under a root. A link planted inside the project that points out of it is refused,
  and so is a dangling link, since a write would follow it out. A link from one allowed root into
  another is accepted.
- The answer is the absolute path, or `null`. The helper never throws: what a refusal means is the
  caller's to say.

## The roots of a project (`projectRoots`)

| root | why it is allowed |
|---|---|
| the project folder | its own clips, renders and presets |
| its workspace (`<home>/workspace/<name>`, else the project's parent) | `../_modules`, `_presets` and the other shared folders of a workspace are read by every project in it |
| the account's library (`<home>/library`) | `@account/…` modules and their sounds |
| each library folder under `librariesHome()` whose name a library may have | every account reads every library (`sharedFolders.md`); a dot-folder there — the relay's — is no library and no root |
| each library overlay | an admin edits a library through its overlay |
| `@meta` modules | k7's own modules ship assets too |
| `<home>/.renders` | automatic freezes (`autoFreeze.md`) |
| the models cache (`modelsRoot()`) | a module's model may live there (`moduleAssets.md`) |

The médiathèque's volume is NOT a root: a project never names its files directly, and the volume
holds every account's uploads.

## What a refusal becomes

- **The compiler**: an escaping clip source is a compile issue beside "file missing", naming the
  clip; an escaping rack sound, Faust slot or render is simply no file — the sound is dropped, the
  slot left unfilled, the freeze not in force. The document an engine is sent never carries such a path.
- **A verb that deletes or copies** confines tighter than the project's roots: `node freeze`
  deletes a render only inside the project, and leaves an escaping one where it is; a lane copy
  reads a `vstpreset:` only from the project's `vstpresets/`. `picture sound` writes the extracted
  sound only inside the project or its workspace.
- **The file service** confines a clip's source again before a preview or a waveform decodes it,
  since a waveform's sidecar is written beside the audio.
- **A share** copies into itself only a FILE named by a typed path field of the document, and
  only from the account's library, renders and models (`packages/file-service/docs/share.md`).
