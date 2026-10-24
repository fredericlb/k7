# A shot's own effect, a grade, a look

```k7x
// graph.k7x — runs nothing feeds, each landing on the lane its shots are on
modules({
  warm: ["main"], // nodes/warm.k7x  extends "@k7-core/shaders/grade"
  film: ["main"], // nodes/film.k7x  extends "@k7-core/shaders/look", lut: looks/film.cube
})

// nodes/main.k7x
extends("@meta/picture-track")
events([
  ref("interview").start(0).length(6).effect("warm"),
  ref("street").start(6).length(4).effect("film"),
])
```

## A shot's effect is a STRETCH that runs for the whole shot

A lane's own run grades every shot on it alike, and a fade's stretch runs only while the shot
crosses ([transitions.md](transitions.md)). What was missing is the run between the two: one shot,
for as long as it is on. That is what `effect:` names, and it is the stretch's own shape, a run of
shaders nothing feeds that lands on the lane, named by its head node. So it needs no new kind of
file and no new compile. It is drawn on the graph as cards with knobs, a step can be bypassed, and
a miss is checked and said exactly as a fade's `chain:` is. The difference is in the renderer: the
run is applied at full presence (`uPresence` 1) for the whole of the shot.

Graph rather than inline on the placement, for the reason a stretch is: an effect is a module with
knobs and a panel, and the graph is where a module is drawn, tuned and shared. Several shots naming
one node share its settings, which is what a grade across a scene wants. A shot that needs its own
gets its own node.

## Where it runs, on one shot's picture

| step | what it is | |
|---|---|---|
| 1 | the shot's `effect` | its own look, on the picture as filmed |
| 2 | its `animate` | where it moves in the lane's frame ([animation.md](animation.md)) |
| 3 | the fade's stretch | what the transition does to it |
| 4 | the blend, then the lane's run | the cut, then the lane's own character |

Effect before motion, so a vignette is part of the picture and moves with it. Lane run after the
blend, so a lane's effect sees the picture the lane shows (`packages/ui-eyes/docs/passes.md`). The
first three are one slot's journey, in `packages/ui-eyes/src/slots.ts`, each step into a target of
that slot's own and allocated only when a shot needs it.

A shot naming no run landing on its lane plays as it is, and the picture's `warnings` say so. An
activation refuses an `effect:`, since it carries no picture to grade.

## `grade`: four knobs, neutral at their middle

`@k7-core/shaders/grade` is exposure (±2 stops), contrast, saturation and temperature, each 0.5 at
rest. A fresh grade node changes NOTHING until a knob moves: a correction that altered the picture
the moment it was added would make every shot look wrong at the moment it is wired. Exposure and
temperature act on linear light, since a stop is a multiplication and only means one there.
Contrast and saturation act on display values, where mid-grey is the grey the eye picks. It is four
knobs because a shader has four (`uP1`..`uP4`); a finer grade is two nodes in a row.

## `look`: a `.cube` LUT, named by the node

`@k7-core/shaders/look` lays a 3D LUT over the picture, `P1` its strength. The FILE is named by the
node (`lut:`, project-relative) and not by the module, so one look module serves every LUT a song
uses, and a LUT a colourist sends is dropped into the project without touching the library. Only
3D LUTs are read, and a malformed file is refused by name (`packages/ui-eyes/docs/luts.md`). Until
the file is on the GPU the pass lets its picture through, and an export waits for it.

Both run on a lane's run, a frame run or a shot's effect alike: where a shader sits is the graph's
business, not the shader's.
