# The `shapes` module — a drawn primitive, wired to a lane

```yaml
# graph.yaml
modules:
  box:    [ titles ]        # both shapes draw on the same picture lane…
  title:  [ titles ]
  titles: [ RENDER ]        # …which composites like any other layer
  RENDER: [ VIDEO_OUT ]
```

A `shapes` module takes **no picture** and gives one: it is a SOURCE, the second one a video
lane has after a lens ([camera.md](../../song/docs/camera.md)). It draws a square, a circle or a
line of text straight onto the viewport, in px.

| port | signal | required |
|---|---|---|
| — | | a shape has no input: nothing upstream of it could change what it draws |
| `out` | video | one, and it lands on a picture lane |

## WHEN it is on — an event that names nothing

```yaml
# video_tracks/title_layer.yaml — the lane the `title` module is wired to
events:
  - { start: 4, length: 4 }      # …and this is when it shows
```

A shape has no duration of its own, so the lane says when it is on, in the one place a lane
already says when anything is on: its `events:`. **An event with no `ref` is an ACTIVATION** — the
same span every other event is, carrying no material. The renderer's interval rule is the one it
already runs for shots: `length: 0` reaches to the next event, and the last one runs on forever.

A lane stating no event at all is on throughout, which is what "a shape with nothing said about
time" should mean — and what makes an activation something you add when you want one, rather than
a line every shape lane has to carry.

Two consequences worth having on purpose:

- **A lane of shapes is drawn like any other lane**, not hatched. It has events; they simply carry
  no material, and a row of spans is exactly what its timing is.
- **`source_from`, `fade_in` and `fade_out` are refused on one**, by the schema and at the key, so
  the editor puts the message on the line. Each needs a source to trim or a picture to cross into,
  and an activation has neither — silently ignoring them is the failure this format keeps avoiding.

A shot placed on a lane of shapes is reported instead of refused: the shapes take the lane over,
so the shot would compile, resolve and be drawn by nobody.

## Why a module rather than a list on the lane

Four things a module has that a list of numbers in a lane file cannot:

- **`params:` are what a CURVE drives.** `x` and `y` on a module are automatable because they are
  params; the same two numbers written into a lane are reachable by nothing.
- **A module is INHERITED.** A lower third lives once in the account's library and a song points
  at it through a thin local module, exactly as it does for a plugin or a shader.
- **A module has a PANEL.** `ui.yaml` gives the geometry knobs, and the module builder edits it.
- **A module is on the GRAPH**, where a reader can see which lane draws it.

So the lane holds only what a lane is for — where in the frame it sits, whether it is hidden, what
runs over it — and says nothing about shapes: which ones it draws is a wire, and the graph is
where a wire is read.

## A shape's folder

```
modules/shapes/title/
  module.yaml            type: shape, shape: text, content/font/color, params: x, y, font_size
  ui.yaml                the knobs
```

```yaml
# modules/shapes/title/module.yaml
type: shape
shape: text              # square | circle | text
content: "LEMO"          # text only — the words
font: sans-serif         # …and the CSS family they are set in
color: "#c8a97e"         # the fill, any CSS colour
params:
  x: 40                  # a square/text x,y is its TOP-LEFT, a circle's its CENTRE
  y: 200
  font_size: 72          # text; a circle takes `r`, a square `w` and `h`
```

**Geometry is `params:` and everything else is a field**, and the split is the one `shader:`
already draws: a param is a number a knob turns and a curve drives, a field decides what is
built. `content`, `font` and `color` are strings, which no knob can be.

`content:` is the key a doc note already uses for its text, and `color:` the one a lane uses for
its colour. One key, read according to what the module IS — the same rule that lets `frame:` mean
a camera's rectangle and nothing at all on anything else.

On a text, `w` is the width its lines **wrap** in, a word wider than it being condensed to fit, so
a `w: 0` has to stay absent: a width of nothing would mean a column of single words. How a text is
set, and captions beside it, is [titles.md](titles.md).

## Where it lands, and what happens when it lands nowhere

The lane the run ends at draws it, and several shapes on one lane stack in the order `graph.yaml`
declares them. Each shape carries its own geometry, so the LANE's rect is ignored and the layer
covers the whole viewport
([../../ui-eyes/docs/compositor.md](../../ui-eyes/docs/compositor.md)).

A shape wired to `RENDER`, or to nothing at all, compiles and then draws nothing. That is the
failure the picture's `warnings` exist for ([picture.md](picture.md)): a blank lane cannot say why
it is blank, so the compile says it instead, naming the module and the wire it wants.

`validate()` accepts a shape on a picture lane, a camera on one, and a fade's stretch — a run of
shaders nothing feeds ([transitions.md](transitions.md)) — and refuses everything else aimed at a
lane: a video effect landing there would be discarded in silence.
