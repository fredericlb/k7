# The curve editor

`ui curve` opens a popin on a NEW curve; `ui curve <id>` opens it on that one. It is where a curve is
made without writing its k7x: a name, a shape, an amplitude, and what the shape takes.

| field | what it is |
|---|---|
| name | the curve's id, which is its file name — a uuid by default for a new curve, editable before the first save, fixed after it (renaming is not this popin's) |
| shape | the four oscillators (sine, triangle, saw, square), an ADSR envelope, a custom curve you draw, or an on/off one for a switch |
| amplitude | 0..1, how far the curve moves what it drives (`packages/song/docs/curves.md`) |
| polarity | bipolar or unipolar, two radio buttons on cut's row — unipolar sweeps from 0, bipolar rides around where the knob sits; only bipolar is written, unipolar being the default |
| cut | none, positive or negative — the half of the output kept; not offered for an on/off curve |
| phase, cycles / bar | an oscillator's — where in its cycle it starts, and how fast it runs |
| duration | an oscillator's length, beside its cycles: a length like `2:0`, `0` for ever |
| A, D, S, R | an envelope's four stages, as knobs, in ms — S is a HOLD, as the file says (`docs/22-syntax-material.md`) |
| the curve | the preview, and for a drawn curve the points themselves: click to add one, drag to move it, double-click to remove it |
| conditions | when it runs — a list, the curve running while ANY holds and always when it is empty; each is start at, end at, between, or on an event of its node (`Note On`, for now), with its own `retrigger`, which restarts the curve each time that condition comes true (`packages/song/docs/curves.md`, "Conditions") |

## From a control: `ui automate`

A widget's right-click offers **`ui automate <node> <param>`**: the same popin, on the control.
If the param already follows a curve (its node's `automations`), the popin opens on THAT curve and
Save only writes it — the binding is already there. If not, it opens on a new curve, and Save writes
it and THEN binds it, `curve set` followed by `node automate`, in that order: a binding to a curve not
yet written would be a reference to nothing.

On a control a curve already drives, the same menu also offers **remove automation**:
`node automate <node> <param> none`, which unbinds the param and leaves the curve where it is — another
control may follow it, and a curve is cheap to keep and costly to redraw. It is offered only then
(the right-click context's `automated`, read off the graph's automation edges), since removing what
is not there is a row that does nothing.

A **curve card** on the graph offers the same two rows: a bound card is one binding, so its
right-click is `ui automate` on the param it drives and the same `remove automation`. A free card,
bound to nothing, has no param to automate and offers `ui curve <id>` instead.

The **shapes it offers follow the param's kind**: a toggle or a button drives a boolean, which follows
an **on/off** curve and nothing else — the shape is shown, greyed, rather than hidden, so it is clear
what the curve is; any other control drives a number, which follows every other shape. `ui curve`
alone, with no param in view, offers all of them. An on/off curve is drawn like a custom one, each
point snapped to off or on and held until the next, with no amplitude to set.

There each condition's event is a **dropdown of what that node announces** (its `events`, `note-on`
on an instrument today), since an event is only worth naming if the node can fire it; a node that
announces none says so and the condition cannot be saved on an event. From `ui curve`, which has no
node in view, the event stays a typed name.

## Choices

**One write, on Save.** Nothing reaches the project while the popin is open: Save sends ONE `curve set`
with every field of the shape picked, so a curve's whole edit is one line in the journal and one
Ctrl+Z. Switching the shape keeps the other shapes' fields in the draft, so trying an envelope and
coming back to the sine loses nothing — only what is picked is written.

**The preview is the bake's arithmetic, and the graph's curve card draws the same one** — `previewOf`
in `curveMath.ts`, which this popin and the card both call. It samples through `@studio/song-schema`'s `curveMath.ts`,
the functions `@studio/song` bakes the engine's breakpoints with, so the picture cannot drift from
what plays. A drawn curve is drawn over its bars (four, or past the last point), an oscillator over
one cycle or its duration (below); an envelope has no song time, so it is drawn over its own length
from the trigger.

**An endless oscillator is drawn as one cycle**, and a quarter of the next faded: its shape is the
whole of what it does, so four bars of it would be four copies of one fact. One with a `duration` is
drawn over that duration, all of it solid, since where it stops is part of what it does.

**The plot always spans -1..1**, with both bounds drawn as lines and 0 dashed between them, whatever
the polarity: a unipolar curve, a bipolar one and a cut are told apart by where they sit against the
same frame, which a plot that rescaled to each would hide. A song-time curve's beats are faint
vertical lines under its bars; an envelope's length is in ms, not beats, so it gets neither.

**A drawn point sits where the curve passes.** The file holds a point's UNIT value (0..1); the plot
shows the output, after amplitude and polarity. Placing a point inverts that, so the point you drag
is on the line you see. Points snap to a sixteenth in time and are kept one per moment, compared by
beat rather than by spelling — `2:1` and `2:1:1` are one moment — the rule `curve point add` follows.
The last point cannot be removed: a custom curve with none is refused by the loader.

**A condition keeps every moment it was given.** Each row holds a start moment, an end moment and
an event name side by side, so switching between `start at`, `between` and `end at` keeps what was
typed; only the kind picked is written, and Save waits until every row's moments are timecodes. The
rows are OR'ed because an AND has nothing to say that `between` does not. The preview draws the
curve's shape, not its conditions: where it runs is a fact about the song, not the curve.

The list is `src/components/CurveConditions.tsx`.

**An existing curve opens from the graph.** `WebGraph.curves` carries each curve's whole definition
(`spec`), so `ui curve <id>` reads it there rather than locating and parsing the file in the browser.

The draft and its arithmetic are `src/curveDraft.ts`, tested on their own; the popin is
`src/components/CurveEditor.tsx`, the picture `CurvePlot.tsx`, the envelope's knobs `CurveKnob.tsx`.
