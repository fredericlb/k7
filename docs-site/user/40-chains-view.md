# The chains view

The chains view is the routing graph of your project: every lane, every input, every module and
every output drawn as a card, joined by cables that carry audio, MIDI, picture or events. It is
the place where you decide what a sound goes through before it reaches the speakers, and where
you turn the knobs of the modules on the way.

Everything you do here is written back to the project's files: the graph lives in `graph.k7x`
(or `graph.k7x`), and each node's settings in `nodes/<name>.k7x`. Nothing is hidden session
state except where the view is looking and which assembly boxes are open.

## Opening it

| How | What you get |
|---|---|
| Press `3`, or run `ui chains` | The whole graph, full page. |
| The **graph** bottom panel (`ui panel graph`) | The signal path of the selected lane only, under the page you are on. |
| The **mix** bottom panel (`ui mixer`) | The graph with every mixer strip lined up on one row. |
| `ui stack` | The graph as stacks: one column per lane, its inputs, its own card, then every module on its path. Run it again to go back. |
| Double-click a lane's header on the timeline | The chains view framed on that lane. |

When something else occupies the graph's place (a note grid, a clip editor, a take review),
`ui slot close` or `Esc` puts the graph back.

## What is drawn

### Cards

| Card | What it is |
|---|---|
| Lane (track) | A lane of the timeline. It has two outputs, `audio` and `midi`, and no input: it is a source. Its card carries mute, solo, arm, highlight, volume and pan, and the list of clips it plays. |
| Input (`IN`) | A live input of your audio interface. It shows which channels it listens on and a **monitor** switch (`off`, `auto`, `on`). Click the input name on a lane to choose what feeds it. |
| MIDI input (`MIDI`) | Notes from a MIDI device, with an LED that lights when the keyboard reaches the browser. |
| Camera (`CAM`) | A live picture source, in a video project. |
| Module | An effect, an instrument, a MIDI transformer or a video effect. Its panel of controls is drawn inside the card. |
| Curve | An automation curve, drawn at the left of the control it drives. Hide or show them with `ui curves`. |
| Note | A text note (a `@meta/doc` module) wired to what it describes. Show or hide notes with `ui notes`. |
| Assembly box | Several nodes drawn as one box. See [Assemblies](./47-assemblies.md). |
| Outputs | `MIX` is the mixer's sum, `OUT` is your audio interface, `CUE` is the headphone bus. In a picture project `RENDER` and `VIDEO_OUT` are their picture counterparts. The `OUT` card carries the song's output level. |

A module whose file or plugin cannot be found is drawn with a `?` and plays nothing. A plugin
that failed to load in the engine shows a warning badge; hover it for the reason. A frozen node
shows a snowflake.

### Cables

Cables are coloured by what they carry: audio, MIDI, picture, or events (a module's announced
events, such as a note-on, drawn as separate sockets). While the song plays, a cable ripples in
proportion to the signal running through it: audio by its level, MIDI by the notes sounding at
the playhead, picture by whether the lane is showing a frame.

### Ports

Most modules have one input and one output. A module with several inputs or outputs shows one
jack per port. In the graph file a port is written after `#`: `crossfade#b` is the `b` input of
the node `crossfade`.

## Moving around

| Gesture | Effect |
|---|---|
| Mouse wheel | Zoom around the pointer. |
| Pinch (trackpad or touch) | Zoom. |
| Two-finger drag on a trackpad | Pan. |
| Drag on empty canvas | Pan. |
| Double-click a card | Fly onto that card. Double-click empty canvas to fly back. |
| Wheel over a long tab column | Scrolls the column, not the view. |

Zoomed far out, cards draw as their name only; zoom in to see their controls again.

The corner **minimap** shows the whole graph and where you are. Click it to move there. Its
buttons:

- **Zoom fit** frames the whole graph again.
- **Organize** runs `graph organize`: every node goes back to the automatic layout and every
  pinned position is cleared.
- The stack toggle switches the stack view on or off.

## Selecting

- Click a card to select it.
- **Shift+click** adds a card to the selection or removes it.
- **Shift+drag** on empty canvas draws a rectangle; every card it touches is selected on release.

When every selected card is a node of the same module running the same engine, the selection is
**linked**: a knob moved on one moves the same knob on all the others, each keeping its own
offset.

## The chain list

In the full-page view a sidebar lists the chains of the project. Click a row to frame that chain;
the rows expand to show the modules in each. Selecting a card on the canvas opens its row.

## Related pages

- [Wiring and placing nodes](./41-wiring-and-nodes.md)
- [Working with a node](./42-node-controls.md)
- [Modules and instruments](./43-modules.md)
