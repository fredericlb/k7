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

## For a host

There is no `activeTracks` prop any more. Pass `trackOrder` and wrap the graph in an
`EngineStoreProvider`, and the cables light up on their own; pass neither and they stay inert,
which is what the médiathèque's module preview wants. One consequence worth naming: any host
that passes `trackOrder` now gets live cables, `TrackModulesPane` included — it always had live
meters and was simply never given the matching prop.
