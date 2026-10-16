# Extending the picture, and testing it

## Recipes

### A new field on a shot

1. Add it to `VideoPlacementSchema` in `packages/song-schema/src/yaml/entitySchemas.ts`. The schema
   is `.strict()`, so an unknown key is refused on its line; if the field needs a source, add it to
   the list the `superRefine` refuses on an activation.
2. Carry it in `VideoClipDoc` (`packages/song-video/src/videoDoc.ts`) and read it in
   `videoPlacementToClip` (`packages/song-video/src/videoTracks.ts`). Keep "absent stays absent".
3. Mirror it in `WebVideoProject` (`packages/web-protocol/types.ts`), in `SceneClip`
   (`packages/ui-eyes/src/scene.ts`) and in `sceneFrom` (`packages/k7-plugins/src/video/sceneFrom.ts`).
4. Use it in `packages/ui-eyes/src/timeline.ts` when it changes *which* frame shows, or in
   `slots.ts` / `motion.ts` when it changes *how* a slot is drawn — every driver goes through those.
5. Decide what the writers must do with it: `splitVideoPlacementAt` (which half keeps it),
   `packages/song/src/videoSound.ts` (does the sound follow it), and
   `packages/song-video/src/interchange/` (carried, or listed as left out).
6. If it is editable by command, add a verb (below) and a writer in
   `packages/song-schema/src/yaml/videoTrackFile.ts` that edits by index and rounds as the others do.

### A new `picture …` verb

Declare it in `packages/commands/commands.yaml` in the picture section: `command`, `sid`,
`readable` in `en` and `fr` (60 characters at most each; the spec test enforces it), `help`,
`surfaces: [cli, timeline]`, `args` with `complete: pictureLanes` for a lane, and `menu: [shot]`
if a shot's right-click should offer it. Implement the handler in `packages/commands/src/verbs/`,
reusing `target`, `laneFile`, `seconds` and `put` from `verbs/picture.ts` (they give addressing,
containment, refusals and the undo snapshot), and list its table in `VERB_TABLES` in
`packages/commands/src/commands.ts`. Long-running work goes through `h.background(tag, work)`.

### A new uniform for shaders

Add it to the shader list in `packages/ui-eyes/src/passes.ts` and set it in the pass-drawing
function there; extend `ScenePass` if it comes from the document. The list is the contract every
shader author reads, so keep its comment the one-line definition of the value.

### A new shape kind

Add the kind to `SHAPE_KINDS` in `packages/song-schema/src/moduleTypes.ts`, a `ShapeDoc` variant in
`packages/song-video/src/videoDoc.ts`, a branch in `compileShape`
(`packages/song-video/src/videoChains.ts`), the matching `SceneShape`, and its drawing in
`packages/ui-eyes/src/rasterize.ts`. Geometry belongs in `params`, as for the existing kinds.

### A shipped shader or transition

A shader is a module folder in a library: `module.k7x` (`type("shader")`, `shader("<name>")`,
`params` P1..P4), `shaders/<name>/vertex.glsl` and `fragment.glsl`, and optionally a `ui.k7x`
panel binding knobs to `P1`…`P4`. `k7-core/modules/shaders/grade/` and
`k7-core/modules/shaders/look/` are the references. A transition is a `video_transitions/<name>`
module with its two stages directly in the module folder, reading `uFrom`, `uTo`, `uProgress`.

### A new project archetype field

The `video` and `live-video` file maps are `videoProjectFiles` in `packages/song/src/scaffold.ts`
and `liveVideoProjectFiles` in `packages/song/src/scaffoldLive.ts`; both splice the base
archetype's graph rather than restating it, and `addVideoRun` (`packages/song/src/videoOutputs.ts`)
adds the `RENDER → VIDEO_OUT` run.

## Tests

Every package here uses vitest (`npm test` in the package, `vitest run`). From the root,
`npm test` runs every workspace. Nothing here needs a GPU, a camera or ffmpeg: the GL-free halves
are split out precisely so they can be tested.

| area | tests |
|---|---|
| schemas and writers | `packages/song-schema/src/yaml/videoTrackFile.test.ts`, `videoTrackYaml.test.ts`, `videoKeys.test.ts`, `videoSpeed.test.ts`, `packages/song-schema/src/aspect.test.ts` |
| the compile | `packages/song-video/src/videoProject.test.ts`, `videoChains.test.ts`, `shaders.test.ts`, `shapes.test.ts`, `videoTitles.test.ts`, `captions.test.ts`, `videoTransitions.test.ts`, `videoStretches.test.ts`, `videoEffects.test.ts`, `videoAnimate.test.ts`, `videoMedia.test.ts`, `camera.test.ts` |
| interchange | `packages/song-video/src/interchange/interchange.test.ts` (writers, round trips), `import.test.ts` (readers, the OTIO 0.18 fixture) |
| song side | `packages/song/src/videoOutputs.test.ts`, `videoSound.test.ts`, `chainPicture.test.ts` |
| renderer | `packages/ui-eyes/src/timeline.test.ts`, `compositor.test.ts`, `passes.test.ts`, `motion.test.ts`, `text.test.ts`, `cube.test.ts`, `camera.test.ts`, `exportSupport.test.ts` |
| plugin | `packages/k7-plugins/src/video/pictureMix.test.ts`, `viewportRect.test.ts`, `shaderAudio.test.ts` |
| verbs | `packages/commands/src/picture.test.ts`, `pictureSpeed.test.ts`, `pictureSound.test.ts`, `pictureMedia.test.ts`, `pictureInterchange.test.ts`, `pictureImport.test.ts`, `pictureRender.test.ts`, `projectAspect.test.ts` |
| media preparation | `packages/video-prep/src/plan.test.ts`, `transcode.test.ts` (the ffmpeg arguments, not a run) |
| frontend | `apps/k7/frontend/src/exportArgs.test.ts`, `videoDrag.test.ts`, `videoSpans.test.ts`, `videoTake.test.ts`, `timelineDrop.test.ts` |

Two tests pin rules that live in two places: `apps/k7/frontend/src/videoSpans.test.ts` holds the
graph's "lane is on screen" spans against the compositor's `activeAt`, and
`packages/k7-plugins/src/video/pictureMix.test.ts` holds the mute/solo/lens fold that both the
timeline and the frame draw. When you change a rule in `ui-eyes/src/timeline.ts`, run both.

The demo project `demos/video-demo.k7` exercises lanes, a picture-in-picture, shapes, a title, a
stretch fade (`iris`) and an audio-reactive shader (`glow`); its `counter.mp4` burns the frame
number into the picture, so sync and `source_from` can be checked by eye.

Every edited `.ts` file must pass biome's lint (`npm run lint` at the root).
