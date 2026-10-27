# A picture lane's strip — the video-mixer

Every picture lane runs through a `video-mixer` node, LAST in its own run, the way every sound lane
ends on its strip ([trackMixer.md](trackMixer.md)). It has four knobs: **red**, **green**, **blue**
and **transparency**. It is how a lane is mixed into the picture, and the node the per-track view
pins to its right edge.

## What was decided

- **It is a shader, shipped with k7.** `@meta/shaders/video-mixer` (`PICTURE_STRIP`), in
  `packages/song/meta/` like the audio strip ([metaModules.md](metaModules.md)): every lane depends
  on it, so no library may remove or change it. Being a shader, its knobs are the four every
  shader has, `P1`..`P4`, each 0..1 ([../../song-video/docs/shaders.md](../../song-video/docs/shaders.md)).
- **Neutral as made.** Red, green and blue at 1 (each channel as shot), transparency at 0 (opaque).
  A strip left neutral is dropped before the compositor (`isNeutralStrip`), so a lane that never
  turns a knob costs no extra pass: any pass puts a layer through an off-screen buffer.
- **Transparency thins alpha alone.** The compositor blends straight alpha, so scaling rgb as well
  would darken the lane before it faded.
- **Last in the lane's OWN run.** It goes right after the run's last item, in that item's chain
  file, ahead of wherever the run leads; a run that led nowhere is led on to `RENDER` by it, as the
  audio strip leads to `MIX`. A lane whose run goes through a linked chain (`main` → `glow`) gets it
  at the end of that chain, so the colour and the fade come after the effect.
- **The audio strip's code, not a copy of it.** Planning, writing, naming (`mix-<lane>`), finding,
  the back-fill, a rename and a delete are `laneStrip.ts`'s, shared with the sound lanes
  ([trackMixer.md](trackMixer.md)); only the module and the sum differ.
- **Every lane gets one, by two routes.** `createPictureLane` makes a new lane with its strip
  (`picture lane new`, `picture import`, a timeline copy, a transcription), and the file service
  back-fills every lane lacking one when a project with a viewport is opened
  (`stripLanes`). A strip that cannot be wired is said (`no strip: …`), never refused.
- **A lane without one is still drawn.** The back-fill makes that rare; hiding the lane instead
  would turn a missing node into a missing picture.
- **Deleted with its lane, and renamed with it** where its name is the lane's, as a sound lane's
  strip is: no other lane runs through it. In a chain project its name is an id, with nothing to follow.

## Its knobs

`node param <strip> P1..P4 <0..1>` writes the node's file, clamped, and the picture is rebuilt from
it: no engine holds a shader. On a card, a shader's knob is its own target (`shader: true`), and the
shell's `onShaderParam` writes it a few times a drag, the last value always landing
(`apps/k7/frontend/src/hooks/useShaderParam.ts`).

A drag is SEEN before it is saved. The write is a quiet command, which reloads nothing, so the
knob is also pushed to every viewport on the page (`shaderLive.ts`) and set on the compositor's
passes in place, no program rebuilt (`setParam`); the picture is read back once the writes stop,
which is also what gives a strip left neutral, and so drawn as no pass at all, its pass.

The graph names each lane's strip in `trackMixers`, read off the graph's `extends` rather than off
the compile, which knows nothing of picture (`laneStripsOf`).
