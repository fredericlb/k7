# The live cable's wobble, and why it is not in the DOM

A cable carrying signal ripples: a travelling sine displaces it along its own normals,
enveloped by `sin(πu)` so both endpoints stay exactly where the still cable's are. That
envelope is why only the cable itself moves — the label and the arrowhead never have to be
redrawn.

It runs for every live cable at once, which makes it the one piece of drawing in this package
where the cost is worth counting. This page is the record of that count.

## What SVG costs, measured

A Firefox profile of st0 during playback, ~23 s on a 149 Hz screen, 15.6 s of CPU on the
content process's main thread:

| | |
|---|---|
| Paint — display list building + WebRender display list | **9.75 s, 62 %** |
| the wobble's rAF | 1.03 s |
| React | 1.35 s |

Writing `d` on a path inside `.dgx-cables` puts that layer on WebRender's **blob image** path
(`Grouper::ConstructItemInsideInactive`, `DIGroup::ComputeGeometryChange`). Changing one cable
invalidates the whole group, so every frame:

- re-serialises the coordinates (~100 ms of `double → string` in the profile),
- has the SVG engine **re-parse** them (~150 ms of `svg_path::parse_number`),
- re-records the entire group into a blob — including the cable **labels**, whose glyphs are
  drawn inside display-list construction (`nsTextFrame::PaintText`, `gfxFont::Draw`),
- and re-uploads the result: 2 859 texture uploads for 2 873 paints, one per frame.

The refresh driver's tick ran 4.6 ms at the median against a 6.7 ms budget, 6.8 ms at p90.
That is the lag, and almost none of it is the path string — still less the allocation inside
the loop. Tightening the wobble itself (a reused buffer, control points as local numbers rather
than objects) leaves that 62 % exactly where it is: it is the LAYER that has to move, not the
loop.

## What it costs on a canvas

The signal cables are drawn on a **canvas**. `wobbleInto` displaces into the same reused
`Float64Array`; `tracePolyline` then calls `bezierCurveTo` with those numbers. No string is
built, nothing is parsed, and the whole layer is one display item whose contents the display
list never looks inside.

Three details are load-bearing:

- **The canvas is not inside `.dgx-world`.** That element carries the camera as a CSS
  transform, and a canvas scaled by CSS resamples — it would go blurry the moment you zoomed
  in. The camera is applied to the 2D context instead (`setTransform(dpr·k, …)`), so the
  drawing code below it still speaks world coordinates exactly as the SVG did.
- **A camera change redraws immediately, the ripple does not.** The ripple is capped near
  `WOBBLE_FPS`, far below a modern screen's rate, because at `WOBBLE_HZ` = 1.2 nobody can tell.
  But a pan redraws in a *layout* effect, in the same frame as the transform: throttle that and
  the cables visibly tear away from their sockets.
- **The shadow is a second `stroke()`, not a second geometry.** As SVG it would be a second
  element with its own `d`, so a live cable would pay the serialise-and-reparse round twice.

### The canvas must be given a CSS size in so many words

`setTransform(dpr·k, …)` is only the right transform if one canvas pixel is `1/dpr` CSS px —
that is, if the element's CSS box is exactly the host's box while its backing store is `dpr`
times that. The backing store is set from `hostSize`; the CSS box takes `width:100%;
height:100%` alongside the insets, because `position:absolute; inset:0` **does not size a
canvas**.

A canvas is a *replaced* element, like an `<img>`: with `width:auto` the two insets are
over-constrained, one of them is dropped, and the used width is the element's **intrinsic**
width — its `width` attribute, which we set in DEVICE pixels. On a `dpr` of 1 that CSS box
comes out exactly right by coincidence; on a Retina Mac it comes out twice the host, so every
cable is drawn at twice its screen position, the ones landing outside the host are clipped
away by `overflow:hidden`, and the survivors sit visibly off their sockets. It reads as a
browser bug and is not one: it is every display whose `devicePixelRatio` is not 1, which is
why a Windows dev machine at 100 % never shows it.

The labels and the hit paths stay in SVG: they do not move, so they cost nothing per frame —
and text is the one thing a canvas would draw worse. The automation cables are on the canvas,
because a cable that sways is a cable that moves: a curve is a node whose cables behave as
cables do — dashed mauve, an arrowhead traced from the last drawn segment, but the same hang,
the same spring, the same layer over the cards (docs/hang.md). Only their param labels remain
in the SVG, being text.

## Why the trace is the contract

`tracePolyline`'s calls are asserted against `smoothPath`, which is the authority on the shape
of a cable: the `moveTo`/`bezierCurveTo` sequence must be the one `smoothPath`'s `d` string
spells out, over straight lines, bends, degenerate inputs and a genuinely wobbled cable whose
coordinates are all irrational. A double survives `toString`/`parseFloat` exactly, so reading
the reference back out of the string is as strict as comparing strings would be.

An optimisation of a drawing path is only safe if the drawing is provably the same, and "looks
fine to me" does not survive a rebase.

## What is left on the table

WebGL is rejected on these numbers. It attacks rasterisation, and rasterisation is not the
problem: the Renderer thread is 5.5 s of the 23, compositing at 0.85 ms a frame.
The one thing it would buy is the sine in a vertex shader, so the JS did nothing per frame at
all — for the price of tessellating polylines with round caps, joins and the automation cables'
dash pattern by hand, all of which Canvas2D gives away. Worth revisiting only if a profile ever
puts `drawCables` back at the top, which ~4 000 curve segments a frame will not.
