# The cables hang, and they swing

A straight line between two sockets is a cable with infinite tension; nothing on a desk looks
like that. `hang.ts` gives every cable the two properties that make the eye read "cable"
instead of "edge": a **shape** that sags under gravity, and **physics** — the slack lags its
endpoints when the cards move, swings, and settles.

## The shape

`hangPoints(from, to, across)` is a cubic with one control point out of each socket:

- along the plate's own axis by a **stub** (`HANG_STUB_*`), which is what makes the cable read
  as *plugged in* — it leaves the barrel square before gravity takes it;
- then pulled down by the **droop** (`HANG_DROOP_*`), which grows with the *horizontal* run
  and not the distance: a cable between side-by-side sockets sags like a hammock, a vertical
  drop hangs nearly straight, because that is what gravity actually does. A parabola-of-sorts
  rather than a true catenary — at these sags the difference is under a pixel, and the cubic
  is what everything downstream already traces.

Two orientations, decided by the nodes' `flow`. Signal running **down** (the normal graph)
leaves the bottom plate downward and arrives at the top plate *from above* — the droop on the
arriving side is capped by the stub, because a cable swinging in from underneath reads as
threaded through the card. The **across** form (the mixer row, side sockets) is the classic
hammock: both control points below their sockets.

The curve is *sampled* (`HANG_STEP`, capped at `HANG_MAX_POINTS`) rather than handed over as
a bezier, because every consumer — the canvas trace, the SVG hit path, `midByArc` for the
label and the insert `+` — already speaks polylines and Catmull-Roms through their points.
Sampling finely enough that the spline through the samples IS the bezier keeps the whole
pipeline unchanged: the wobble, the trace contract, the labels all follow the sag for free.

## The physics

One damped spring per cable (`CableSway`), on the slack's offset from rest. It is excited by
**endpoint motion**: `exciteSway` remembers where the sockets were, and their movement since
becomes the opposite offset — the slack stays put for an instant while its ends move on,
which is inertia as the eye knows it. `stepSway` is semi-implicit Euler on a spring tuned
underdamped (`SWAY_K`, `SWAY_DAMP`): a visible overshoot, settled in about a second, clamped
to `SWAY_MAX` because slack is finite. A settled spring snaps to *exact* zero and reports it,
so the loop that steps it can stop instead of chasing ever-smaller numbers.

The offset is applied at **draw time** under the same `sin(πu)` pinned-ends envelope as the
wobble (`swayInto`, and a live cable folds it into `wobbleInto`): however hard a cable swings,
it stays plugged in, and the SVG's hit paths and labels keep the *rest* geometry — a swinging
cable is a drawing, not a moving target.

In the renderer (DomChains) the springs live in a map keyed by edge id, excited wherever the
draw list is rebuilt — every frame of a node motion, and the landing of a new layout — and
stepped by their own rAF loop beside the wobble's, running only while something still moves.
The camera never excites anything: pan and zoom move the *view*, and the offsets are world
units, so a cable holds still while you look around. First sighting excites nothing either —
a graph must not swing on mount.

## The automation cables are the same cable

A curve is a node, and its cables behave as cables do: the mauve automation runs hang
(`hangPoints` from the curve's out socket to the knob they drive), carry the same spring, and
draw on the same canvas over the cards — wearing their own dress (`AUTO_*` in cableCanvas.ts:
thinner, dashed over a solid shadow, at a fifth of its opacity, and no head: the knob it lands on
glows mauve, which says where it ends better than an arrow pointing at it. Faint because a binding
is context for the signal path and never in front of it — and for the same reason it takes no
pointer at all: a click on one goes through to whatever is under it. The cable a node's event fires
a curve with is an automation cable too, and wears the same dress (`AUTO_DRESS` in DomChains). Only the param label stays in
the SVG, at the cable's opacity, text being the one thing a canvas draws worse.

## Over the cards

The cable canvas sits above the node cards (`z-index` on `.dgx-cablecv`): a patch bay's
cables lie on top of the rack, and each cable's shadow is what seats it visually on the card
face it crosses. This is safe because the canvas never takes the pointer — and the SVG layer
(hit paths, labels, the insert `+`) deliberately stays *below* the nodes, so nothing a card
offers becomes unclickable under a cable. Only the paint rides on top; every affordance stays
underneath.
