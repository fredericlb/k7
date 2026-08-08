# The live cable's wobble, and what it allocates

A cable carrying signal ripples: a travelling sine displaces it along its own normals,
enveloped by `sin(πu)` so both endpoints stay exactly where the still cable's are. That
envelope is why only the two `<path>` elements move — the arrowhead and the label never
have to be redrawn.

It runs at 60 Hz for every live cable at once, which makes it the one piece of drawing in
this package where allocation is worth counting.

## What it used to cost

The renderer already knew this and had escaped React for it: the per-frame update writes
`d` straight onto the path nodes rather than going through state, and the comment above it
said the loop "allocates NOTHING per frame". That was not true, and the shape of the untruth
is worth recording because it read as a solved problem for as long as it stood.

Two allocations survived, both inside `wobbleD`:

- the displaced polyline was built with `buf.push({ x, y })` — the *array* was reused, the
  **points were not**, so one object per sample;
- `smoothPath` then called `cubicSegments`, which builds one `Cubic` **plus two fresh `Pt`s
  for the control points** per segment.

At `n` samples that is `n + 3(n-1)` objects, so ~381 per cable per frame at the 96-sample
cap. On a 40-cable graph: ~15 000 objects a frame, ~900 000 a second. The figure the old
comment quoted as *removed* — 149 KB of path strings, 8.7 MB/s — was in fact still being paid,
because only the React reconciliation had gone.

## What it costs now

`smoothPathXY` takes a flat `[x0,y0,x1,y1,…]` buffer and emits the path directly, computing
each segment's control points into local numbers instead of objects. `wobbleD` displaces into
a reused `Float64Array`. **Object allocation is zero.**

The buffer grows only when a cable needs more room than it has. `maxSamples` in
`buildCableGeom` is a target rather than a ceiling — `Math.max(1, …)` gives every segment at
least one sample, and the closing endpoint adds one more — so a cable with many waypoints can
exceed it, and a fixed-size buffer would have silently truncated such a cable to a shorter one.

What remains is **one string per live cable per frame**, and that is not removable while the
cables are SVG: `setAttribute("d", …)` takes a string, and the browser exposes no numeric path
API to write instead. Removing it means leaving SVG — a Canvas2D cable layer would call
`bezierCurveTo` with numbers and allocate nothing at all, and would reproduce the round caps,
the `5 4` dash and the half-alpha shadow with identical semantics. That is the one place in
this graph where moving off the DOM would pay; it is not, notably, WebGL's doing — Canvas2D
is enough, and the load here is two orders of magnitude below where a GPU starts to matter.

## Why byte-identity is the contract

`smoothPathXY` is asserted **equal to `smoothPath`, string for string**, over straight lines,
bends, degenerate inputs and a genuinely wobbled cable whose coordinates are all irrational.
That test is the entire safety argument: an optimisation of a drawing path is only safe if the
drawing is provably the same, and "looks fine to me" does not survive a rebase.

The two functions are kept side by side rather than one being written in terms of the other,
because the point of the flat one is precisely that it does *not* build the intermediate the
other returns.
