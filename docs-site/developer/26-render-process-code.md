# Rendering, export and bouncing

Several arrangement verbs need audio **rendered offline**: the mixdown, an audio consolidate, a
crossfade's material, a bounce through a chain, a freeze. None of them runs in the
browser or in the file service's own process; they hand a compiled document to an engine binary and
read back files. This page covers that seam and the verbs on top of it. Video export is covered in
the picture range.

## The renderer seam

`packages/take-render/src/renderer.ts` defines `Renderer`: a function that takes a compiled document
and an output folder and resolves to a `RenderManifest` (`parseManifest` reads the engine's stdout).
`localRenderer(bin, timeout)` runs the engine binary as a one-shot process with `--render`;
`renderToWav` is the common wrapper.

Which renderer a verb gets is the file service's decision, in `serviceRenderer`
(`packages/file-service/src/renderers.ts`), tried in order:

1. the engine binary on the service's own machine, as a separate process;
2. otherwise the engine machine the workspace is bound to, over the tunnel;
3. otherwise a render job service named by `STUDIO_RENDER_JOBS_URL`, whose results are staged and
   copied in.

A verb asks for it through the command host (`rendererOf(h)` in `packages/commands/src/verbs/shared.ts`)
and refuses by name when there is none ("no engine to render with — …"). That is why an audio
`event split` or `selection consolidate` needs an engine while the sequence versions do not.

## The mixdown

`project export audio wav|mp3` is a shell-local verb (`apps/k7/frontend/src/exportArgs.ts` parses it;
`apps/k7/frontend/src/hooks/useShare.ts` runs it). It calls `GET /export?format=` on the file service
(`packages/file-service/src/routes/files.ts`), which calls `exportMix` in
`packages/file-service/src/shareOps.ts`: render the cached compiled document into a temporary folder,
transcode to MP3 with ffmpeg when asked (`MP3_CODEC`, `transcode` in
`packages/take-render/src/render.ts`), stream it back as an attachment, and clean up. The browser
saves the blob (`downloadBlob.ts`); nothing lands in the project. The old bare `project export wav`
is refused on purpose — the first word says which half of the project leaves.

## Splitting and consolidating material

`packages/take-render/src/materialRender.ts` holds `consolidateAudioMaterial`: render a range on one
lane (gaps kept as silence) into one new file, write its `clips/<id>.k7x`, and replace the
placements. An audio split renders nothing: it places the same file twice, windowed either side of
the cut (`splitAudioPlacement` in `packages/song-edit/src/materialCut.ts`, where the sequence split
and consolidate are text edits too). The material a consolidate or a sequence split replaced is left
on disk, since another lane may still play it. A split refuses a looped event — the cut position has
as many answers as there are passes.

## Bouncing through a chain

`track process`, `clip process` and `event process` all end in `processWithChain`
(`packages/audio-passes/src/processChain.ts`):

1. `resolveChain` finds the chain — a project chain, or `@library/path` — and refuses one that has
   no treatment (only the lane's strip), steps the machine cannot load, or both separates and
   processes.
2. `resolveTargets` lists the source files.
3. Each is bounced through a one-track document holding the raw file at 0, no warp, no window
   (`bounceDoc`, `bounceThroughChain`). A project chain drops its Mixer strip.
4. The result is written beside the source as `<name>_<chain>_<stamp>.wav` (`renderPath`); a rerun of
   the same chain replaces its stamp, a different chain stacks.
5. `repointClips` points every clip file at the new source and retimes its warp markers to the new
   length.

The previous render is snapshotted through the host before being overwritten, which is what makes the
step a `process` journal entry and why undoing it asks first.

`packages/audio-passes/src/peakPass.ts` measures the source's peak first when a step declares a
`Peak` parameter (a normaliser needs it). `coldPass.ts` handles **offline** steps — a module that
cannot run in real time, such as stem separation — which write into `stems/` beside the source
instead of replacing it.

`event process` (`packages/commands/src/verbs/eventProcess.ts`) is `clip process` for one event: when
anything else plays the same material, it first gives the event its own copy of the clip
(`clips/<ref>-N.k7x`) and rewrites only that placement, so a right-click on one event never changes
the others; a bounce that writes nothing undoes the copy.

## Freezing

`node freeze` (the lane's alternative badge, or the chains graph) bakes everything upstream of a node
into one render with `freezeUpstreamRender` (`packages/take-render/src/render.ts`) and marks the
module `frozen:`. The timeline then draws the lane's block as a render: it cannot be moved, and a
double-click opens the authored notes under it (`openFrozenNotes` in `TimelineTab.tsx`).

## Reading the arrangement as text

`packages/take-render/src/timeline.ts` is a script, not an export: it prints a song's arrangement as
text, the timeline's reader for a terminal.

```bash
npx tsx packages/take-render/src/timeline.ts <project> [track]
```

## See also

- [Mixer, meters and mastering](./25-mixer-mastering-code.md)
- [The edit path](./21-edit-path.md)
