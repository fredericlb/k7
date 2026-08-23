# Which cables carry signal, and why that never enters a render

A cable is drawn *live* — it ripples — when the track feeding it is above the silence floor.
That fact comes from the engine's meters, so it moves at the frame rate, and on percussive
material tracks cross −60 dB several times a second. It used to arrive as a prop.

## What the prop cost

`ChainsTab` and `GraphPanel` each called a `useActiveTracks(trackOrder)` hook and passed the
result down as `activeTracks`. Every crossing of the floor therefore:

1. re-rendered the host (`ChainsTab` including its whole sidebar);
2. re-rendered the `DomChains` body — three thousand lines of hooks and memos;
3. re-ran `computeLive`, a fixpoint over every edge;
4. rebuilt `cableDraws`, one fresh object per edge;
5. and only then repainted the canvas.

Steps 1–4 exist to reach step 5. Nothing else in the tree reads liveness: grep `live` in
`DomChains.tsx` and the only consumers are `cableDraws` and the ripple loop. No node, no
widget, no SVG label, no hit path. The prop was making a **canvas** concern travel through
React's reconciler to get to a canvas.

## What it is now

`DomChains` subscribes to the host's store itself, through a raw `store.subscribe`, and keeps
the whole chain in refs:

```
levels frame → activeTrackIds(snapshot, trackOrder) → activeRef
             → computeLive(model.signal, …)         → liveRef
             → cableDraws                            → cableDrawsRef
             → paintRef.current()  +  rippleRef.current()
```

A crossing of the floor now repaints the canvas and **re-renders zero components**. The
subscription bails on `arrayEq` before doing any of it, so a steady signal costs one comparison
of a short id list per frame.

Three things hold this together, and all three are load-bearing:

- **`activeTrackIds` is a pure function, not a hook** (`@studio/engine-browser/store`). Made a
  hook it would be a re-render again; kept pure it is callable from a subscription. The −60 dB
  floor lives there and nowhere else.
- **`rebuildCables` and `applyLive` are reassigned on every render**, like `paint` and `fit`
  beside them. That is what lets a subscription bound once still see the *current* edges without
  taking the graph as a dependency.
- **A graph change goes through `applyLive` too**, not just a meter frame. The liveness set is
  keyed by EDGE id, so new edges mean it has to be recomputed even though the track ids did not
  move.

## The ripple loop follows the same rule as the camera

It is mounted once and steered by `liveRef`, rather than being an effect with `[live]` as a
dependency — there is no longer a re-render for such an effect to hang off. It stops itself
when nothing carries signal and `rippleRef.current()` restarts it when something does: started
by a signal, stopped by stillness, which is what `camera.md` says about the pan and the zoom.

## The two SUMS are seeded, not reached

Liveness walks FORWARD from the tracks, and neither sum has anything arriving at it: no cable is
drawn into `MIX` or into `RENDER`, because every lane ends there and the arrows said nothing the
picture did not (`@studio/ui-chains`'s docs/graphBuild.md). So the master run — the one cable
carrying the whole song — was the only still cable on a playing graph.

`computeLive` therefore starts the walk at `MIX` too, whenever any track is metered. That is
exact rather than a stand-in: every track feeds the master bus whatever its chain names
(@studio/song's docs/masterChain.md). `RENDER` is seeded the same way, from the picture's own
list below.

## The picture has no meters, so it is DERIVED

The engine measures sound and knows nothing of the frame, so `activeTrackIds` is silent about a
video lane — every cable on the picture side of the graph stayed still through a playing song.
What the browser has instead is the shots and the playhead, which is the same bargain st0 already
strikes for a rack's lit pads (`apps/st0/frontend/src/rackLit.ts`).

A host passes `videoSpans`: when each video lane is showing a picture, in seconds. A **prop**
rather than a subscription, and the split is what each thing does — the meters move twenty times
a second, a lane's shots move when somebody cuts one. The renderer reads the playhead off the
same engine frame it reads the levels off and answers `liveVideoLanes` itself, so a moving
playhead still re-renders nothing.

Three rules hold it honest:

- **The interval rule is the compositor's**, not the graph's. st0 builds the spans with
  `@studio/ui-eyes`'s `activeAt` rule — a cut belongs to the later shot, a shot with no length
  runs to the next one, a hidden lane shows nothing, a shape lane draws while unhidden — and
  `videoSpans.test.ts` asserts the two agree point by point rather than restating it. A cable
  rippling over a black viewport would be worse than one that never ripples.
- **A lane is live only while the transport RUNS.** A paused frame is a held picture, and nothing
  travels along a cable to hold it — which is what a stopped meter says about sound.
- **The two lists stay apart.** Sound reaching `MIX` says nothing about picture reaching
  `RENDER`, so `computeLive` takes them separately and seeds one sum from each.

## For a host

There is no `activeTracks` prop any more. Pass `trackOrder` and wrap the graph in an
`EngineStoreProvider`, and the cables light up on their own; pass neither and they stay inert,
which is what the médiathèque's module preview wants. One consequence worth naming: any host
that passes `trackOrder` now gets live cables, `TrackModulesPane` included — it always had live
meters and was simply never given the matching prop.

`videoSpans` is the same bargain for the frame: a host with no picture passes none and the video
cables stay still, which is what they did for everybody before it existed.
