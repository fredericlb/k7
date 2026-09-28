# The minimap

A small map of the whole graph in the bottom-right corner of the chains pane: every card as a
block, the pane's view as a frame over them, and two buttons on top — **Zoom fit** and
**Organize**, drawn as icons (`Maximize`, `Network`) whose tooltip names them. `Minimap.tsx`
draws it; `DomChains` places it and owns everything it does.

## It is opt-in, and st0's chains pane is the one that opts in

`minimap` is a prop, off by default. The graph is also drawn in the editor column's panel, in a
lane's own row and in the module builder's preview; those are small enough that a map would take a
real share of what they show, and a preview of one card has nothing to navigate. A ROW never gets
one: the mixer view is walked along, not zoomed around (`camera.md`).

## It repaints from the graph's paint, not from React

The camera is not React state (`camera.md`), so a map that re-rendered on camera changes would
never re-render at all. `DomChains`' `paintRef` is the one place every camera move passes through —
a pan, a zoom frame, a flight, a `place` — so the map's paint is called from there, and reads the
camera and the pane's size off the same refs the graph does. The cables repaint about thirty times a
second while signal flows; the map remembers what it last drew and skips a frame in which the
camera, the pane and the cards are all unchanged.

The cards it draws are the LAID-OUT graph's, so a card being dragged shows where it was until the
drop writes its pin.

## A press or a drag centres the view there

At the zoom the pane already has: the map answers "where", and the wheel is still what answers "how
close". The press and the double-click are both stopped at the map, so neither starts a pan nor
counts as a double-click on the bare canvas (which would fly the camera back — `camera.md`).

## Zoom fit is the FIRST frame, and gives the camera back

It runs the same `fit` the graph frames itself with when it opens, drops a flight in progress and
forgets the view a double-click would return to. It also marks the camera as no longer the user's,
which is what "the original zoom and pan" means: until somebody moves it again, a resize of the pane
re-frames it, as it did before anybody touched it.

## Organize is the host's

`graph organize` is a command that rewrites `positions:` and bumps the shell's `organizeKey`, so
it has to go through the host's reloading command path — the renderer's `command` prop is the QUIET
one, which reloads nothing. The button therefore exists only when the host passes `onOrganize`; st0
runs `graph organize` through `runCommand` (`apps/st0/frontend/docs/chainsGraph.md`).
