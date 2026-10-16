# Which cables carry signal, and why that never enters a render

A cable is drawn *live* — it ripples — when the track feeding it is above the silence floor.
That fact comes from the engine's meters, so it moves at the frame rate, and on percussive
material tracks cross −60 dB several times a second.

## Why it is not a prop

As a prop, `ChainsTab` and `GraphPanel` would each call a `useActiveTracks(trackOrder)` hook and
pass the result down as `activeTracks`. Every crossing of the floor would then:

1. re-render the host (`ChainsTab` including its whole sidebar);
2. re-render the `DomChains` body — three thousand lines of hooks and memos;
3. re-run `computeLive`, a fixpoint over every edge;
4. rebuild `cableDraws`, one fresh object per edge;
5. and only then repaint the canvas.

Steps 1–4 exist to reach step 5. Nothing else in the tree reads liveness: grep `live` in
`DomChains.tsx` and the only consumers are `cableDraws` and the ripple loop. No node, no
widget, no SVG label, no hit path. A prop makes a **canvas** concern travel through
React's reconciler to get to a canvas.

## How it arrives instead

`DomChains` subscribes to the host's store itself, through a raw `store.subscribe`, and keeps
the whole chain in refs:

```
levels frame → seedFlows(per-lane dB / notes / picture) → seedRef
             → computeFlow(model.signal, seeds, …)      → liveRef
             → applyFlow: move each draw's `flow` in place
             → paintRef.current()  +  rippleRef.current()
```

A level moving repaints the canvas and **re-renders zero components**. The subscription bails on
`seedsEq` before doing any of it, so a steady signal costs one comparison of a short map per frame.

Three things hold this together, and all three are load-bearing:

- **`seedFlows` is a pure function, not a hook** (`@studio/ui-chains/flow`). Made a hook it would
  be a re-render again; kept pure it is callable from a subscription. The −80 dB floor lives there
  and nowhere else.
- **`applyFlow` moves the numbers and rebuilds NOTHING.** A meter frame arrives twenty times a
  second, and `rebuildCables` re-runs `exciteSway` on every cable — kicking each spring twenty
  times a second for ever, besides reallocating the array. Only a change to the GRAPH rebuilds.
- **`rebuildCables`, `applyLive` and `applyMeter` are reassigned on every render**, like `paint`
  and `fit` beside them. That is what lets a subscription bound once still see the *current* edges
  without taking the graph as a dependency.
- **A graph change goes through `applyLive` too**, not just a meter frame. The liveness set is
  keyed by EDGE id, so new edges mean it has to be recomputed even though the track ids did not
  move.

It is the ONE subscription in `DomChains.tsx` that is not a leaf's, and the picture rides along on
the same frame rather than taking a second: the playhead arrives in it, and subscribing twice
would recompute liveness twice for one engine tick. The store it subscribes to is the HOST's own —
read once here and once at the bottom, where it also decides which store the meters get — and an
inert one simply never notifies.

## The canvas layer's own geometry

`.dgx-cablecv` is the cables' layer, and three of its declarations are load-bearing:

- **It is never a pointer target.** Hit testing stays on `.dgx-hit`, which is SVG and follows the
  cable at rest.
- **`width`/`height` are not redundant with `inset:0`.** A canvas is a REPLACED element, so with an
  `auto` width the insets are over-constrained and its INTRINSIC size — the `width`/`height`
  attributes, which we set in DEVICE px — wins. `@studio/ui-chains`'s docs/wobble.md is the page.
- **`z-index:2` puts it OVER the cards.** A patch bay's cables lie on top of the rack, not behind
  it, and the shadow each cable already strokes is what seats it visually on the card face it
  crosses. Safe because the layer takes no pointer: the SVG's hit paths, labels and inserts stay
  below the nodes, so nothing a card offers becomes unclickable under a cable.

## What stays on the SVG layer above it

The cable is on the canvas; its NAME is not. Text is the one thing a canvas draws worse, so the
labels — a signal cable's, and an automation cable's param — stay in SVG. The automation label sits
at the chord midpoint on purpose: the hang sags below it, so the label sits clear of its own cable.
The insert affordance is there too: a transparent hit path over each eligible arrow, plus the blue
recolour and circled `+` while it is hovered.

There is **no arrowhead**. A cable ends in a PLUG, and the plug is the
socket it disappears into — the nodes paint over this layer, so the last few pixels are hidden by
the plate and the cable reads as seated. An arrow is the right mark only for a cable pointing at a
card with nowhere in particular to land. Direction is not lost without it: the graph is laid out top
to bottom, inputs on a card's top edge and outputs on its bottom, so which way a cable runs is read
off where it lands.

Automation cables draw on the canvas with all the others, hanging and swaying the same way — a curve
is a node, and its cables are cables.

## The ripple loop follows the same rule as the camera

It is mounted once and steered by `liveRef`, rather than being an effect with `[live]` as a
dependency — there is no re-render for such an effect to hang off. It stops itself
when nothing carries signal and `rippleRef.current()` restarts it when something does: started
by a signal, stopped by stillness, which is what `camera.md` says about the pan and the zoom.

## The two SUMS are seeded, not reached

Liveness walks FORWARD from the tracks, and neither sum has anything arriving at it: no cable is
drawn into `MIX` or into `RENDER`, because every lane ends there and the arrows say nothing the
picture does not (`@studio/ui-chains`'s docs/graphBuild.md). So the master run — the one cable
carrying the whole song — would be the only still cable on a playing graph.

`computeLive` therefore starts the walk at `MIX` too, whenever any track is metered. That is
exact rather than a stand-in: every track feeds the master bus whatever its chain names
(@studio/song's docs/masterChain.md). `RENDER` is seeded the same way, from the picture's own
list below.

## The picture has no meters, so it is DERIVED

The engine measures sound and knows nothing of the frame, so the levels are silent about a
video lane, so every cable on the picture side of the graph would stay still through a playing song.
What the browser has instead is the shots and the playhead, which is the same bargain k7 already
strikes for a rack's lit pads (`apps/k7/frontend/src/rackLit.ts`).

A host passes `videoSpans`: when each video lane is showing a picture, in seconds. A **prop**
rather than a subscription, and the split is what each thing does — the meters move twenty times
a second, a lane's shots move when somebody cuts one. The renderer reads the playhead off the
same engine frame it reads the levels off and answers `liveVideoLanes` itself, so a moving
playhead still re-renders nothing.

Three rules hold it honest:

- **The interval rule is the compositor's**, not the graph's. k7 builds the spans with
  `@studio/ui-eyes`'s `activeAt` rule — a cut belongs to the later shot, a shot with no length
  runs to the next one, a hidden lane shows nothing, a lane of shapes follows its activation spans — and
  `videoSpans.test.ts` asserts the two agree point by point rather than restating it. A cable
  rippling over a black viewport would be worse than one that never ripples.
- **A lane is live only while the transport RUNS.** A paused frame is a held picture, and nothing
  travels along a cable to hold it — which is what a stopped meter says about sound.
- **The two lists stay apart.** Sound reaching `MIX` says nothing about picture reaching
  `RENDER`, so `computeLive` takes them separately and seeds one sum from each.

## For a host

There is no `activeTracks` prop. Pass `trackOrder` and wrap the graph in an
`EngineStoreProvider`, and the cables light up on their own; pass neither and they stay inert,
which is what a module preview wants. Any host that passes `trackOrder` gets live cables,
`TrackModulesPane` included.

`videoSpans` is the same bargain for the frame: a host with no picture passes none and the video
cables stay still.

## …and HOW HARD, which is a second question

Which cables move is this walk; how much each moves is [flow.ts](../../ui-chains/src/flow.ts), and
the size of the ripple is [wobble.md](../../ui-chains/docs/wobble.md). Two things about it belong
here, beside the subscription:

- **The seed is per LANE and carries all three measures** — its level in dB, its notes sounding,
  whether it is showing a picture. A cable takes the one matching what it carries, which is how one
  sequences lane ripples its MIDI cable with the notes and its instrument's audio cable with the
  meter.
- **Nothing meters MIDI, and nothing meters a frame.** The engine sends levels for sound and
  silence about the rest, so both of those are DERIVED in the browser from what it already holds:
  `videoSpans.ts` for the picture and `noteSpans.ts` for the notes, each memoised on the document
  and handed in as a prop.

The subscription reads all three off one frame, builds the seeds, and stops at `seedsEq` when
nothing moved — which is most frames, and is what keeps a 20 Hz meter from walking the graph.

## An assembly's box, open or closed

`chainsModel.ts` is where a box changes the cables. With a box OPEN, the cables that are not its
own are the traffic crossing it: they still run right over the frame, at half strength, so the
wiring inside reads first; nothing fades otherwise. A CLOSED box has swallowed its lanes' cards, so
a metered lane's signal leaves from the box instead (`foldedAt`) — without it a folded set reaches
nothing and not one cable ripples.
