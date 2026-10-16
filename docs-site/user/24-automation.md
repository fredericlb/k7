# Automation and curves

Automation in k7 is two things kept apart:

- A **curve**: a shape over song time (or over a note), kept in its own file under `curves/`. It
  produces a value from 0 to 1 — or −1 to 1 when bipolar.
- A **binding**: a module's parameter told to follow a curve. One parameter follows one curve;
  binding a second replaces the first.

So you can make a curve once and point several knobs at it, or unbind a knob and keep its curve.

## Automating a track's parameter

From the lane — no need to know which module in the chain owns the parameter:

```text
track automation add gtr Filter Freq
```

This creates a curve that is **flat at the knob's current position**, so binding changes nothing
until you move a point. It is refused when k7 cannot tell where the knob sits, or when two modules
on the lane's chain share that parameter name (then use `node automate`, which names the module).
The parameter is everything after the track, spaces included.

```text
track automation remove gtr Filter Freq    # unbind; the curve file stays
```

Right-click the lane to find both on its menu.

## Automation rows on the timeline

Every bound parameter of a lane draws an **automation row** under it, indented, labelled with the
parameter's name (hover for `module · param ← curve`). A drawn curve shows as a line across the row.
Toggle all rows with the curve button in the tool strip or `ui automation`.

Right-click an automation row at the moment you want; the position is snapped to the nearest drawn
tick and offered to three commands:

| Entry | Command | Notes |
|---|---|---|
| point add | `curve point add sweep 5:1:1 0.8` | You type the value (0..1). Adding at a moment that already has a point sets that point. |
| point move | `curve point move sweep 5:1:1 7:1:1 [value]` | You type the new position; the value is kept unless you give one. |
| point remove | `curve point remove sweep 5:1:1` | The last point of a curve cannot be removed — unbind instead. |

A point is addressed by its moment, since a curve has one value per moment. The value is in the
curve's range, not the parameter's; mapping it onto the knob is the module's business.

Points move with `project add` / `project remove` when you insert or remove time.

## The curve editor

`ui curve` opens a popin to create a new curve; `ui curve sweep` edits an existing one. From the
graph, right-click a control and choose **automate** (`ui automate synth "Filter Freq"`) to edit the
curve it follows, or create one bound to it. Nothing is written until you press **Create** /
**Save**, which is one `curve set` command and one undo step.

| Field | Meaning |
|---|---|
| name | The curve's id and file name — letters, digits, `_` and `-`. |
| shape | sine, triangle, saw, square (oscillators), ADSR envelope, custom (drawn), or on/off for a switch parameter. A switch can only follow on/off. |
| amplitude | Depth. |
| phase | Where an oscillator starts in its cycle. |
| polarity | **bipolar** (−1..1) or **unipolar** (0..1). |
| cut | none · positive (keep 0..1) · negative (keep −1..0). |
| cycles / bar | An oscillator's rate. |
| duration | How long it runs, as a length like `2:0`; `0` runs for ever. |
| A / D / S / R | The envelope's four stages, in milliseconds. |
| conditions | When the curve runs: from a moment (`start`), until one (`end`), between two, or on its node's event (`Note On`). Rows can be added and removed. |

For a **custom** curve, the preview is editable: click to add a point, drag one to move it,
double-click one to remove it (a drawn curve keeps at least one point).

The preview is computed with the same arithmetic the engine uses, so what you see is what plays.

### An envelope's trigger

An ADSR curve restarts on note-ons. By default the module it drives is its trigger — a filter
envelope follows its own synth. To have another module's notes restart it, name it when binding:

```text
node automate filter "Cutoff" env1 lead
```

## Typed commands

| Command | Effect |
|---|---|
| `curve new sweep` | Create a curve (an LFO you then edit). |
| `curve set wobble {"type":"lfo","shape":"saw","frequency":2,"phase":0,"amplitude":0.5}` | Write a curve whole from its fields, creating or replacing it. |
| `node automate osc "Filter Freq" sweep` | Bind a curve to a module's parameter. |
| `node automate osc "Filter Freq" none` | Remove the binding; the curve stays. Also **remove automation** on the control's right-click. |
| `track automation add|remove <track> <param>` | The same binding, reached from the lane. |
| `curve point add|move|remove …` | Edit a drawn curve's points. |

In the per-track graph view, `ui curves` shows or hides the curve cards beside the modules they
drive.

## See also

- [The arrangement timeline](./20-timeline.md)
- [Clip editors](./23-clip-editors.md)
