# Wiring and placing nodes

A **node** is one use of a module in your project: `reverb`, `lead`, `amp_1`. A **module** is
what the node is made of, usually taken from a library (see
[Modules and instruments](./43-modules.md)). This page covers adding nodes to the graph,
connecting them, and moving them around. Every gesture below runs a command, which you can also
type in the command bar.

## Adding a node

### On a cable

Hover a cable: a `+` appears at its middle. Click it and the **module picker** opens. It browses
your modules by namespace, then type, then category, with a search field at the top for when you
already know the name. Pick a module and the new node is spliced into that cable, between its two
ends. The picker also offers **new curve…**, since an automation curve is a node too.

While the commands run, a placeholder card stands where the node will land.

The command behind it is `node insert`:

```text
node insert melody OUT wah
```

splices the node `wah` into the cable from `melody` to `OUT`.

### On empty canvas

Right-click empty canvas: the same picker opens, and the node is created where you clicked,
wired to nothing. Connect it afterwards with a cable.

### In a module row

Where modules are drawn glued edge to edge (a lane's own row, the stack view), a `+` appears on
each seam between two cards that a cable joins, and one past the last card. In a chain project the
seam has a second button that **stacks** a new node under the card on its left (`node stack`): the
two then run as one subchain in that place.

### By command

| Command | What it does |
|---|---|
| `node new <category/name> [node-name] [extends-ref] [at]` | Create a node of a module and put it in the graph, wired to nothing. It is named `<module>_<n>` unless you give a name. With an `extends-ref` from a catalogue, it creates the module folder first. Example: `node new instruments/synth lead`. |
| `node insert <before> <after> <node> [at]` | Splice a node into the cable from `before` to `after`. |
| `node stack <node> <new>` | Put a freshly created node under another, both in one subchain. |
| `node replace <node> <extends-ref>` | Point a node at another module, keeping its place. Its name follows the new module if it was auto-made. Example: `node replace echo @k7-core/audio/delay`. |
| `graph unlink <node>` | Take a node out of its chain, joining what fed it to what it fed. |
| `node delete <node>` | Delete a node: its file, its preset and its place in the graph. |

## Connecting cables

Each card has **jacks**: outputs on one side, inputs on the other, one per port. Jacks only
accept cables of their own type: an audio output finds audio inputs, a MIDI output MIDI inputs.

- **New cable**: press on a free output jack, drag, and release on a free input jack. Or click
  the output jack, then click the input jack.
- **Move a cable**: press on an occupied jack. The cable's end lifts off and follows the pointer;
  drop it on another jack. This re-plugs the cable in one undo step.
- **Delete a cable**: lift its end and drop it on empty canvas.
- **Cancel**: press `Esc` or right-click while a cable is in hand. Nothing is written.

The commands:

| Command | Example |
|---|---|
| `graph chain connect <from> <to>` | `graph chain connect gtr reverb`, or `graph chain connect splitter#b wet` to leave from output `b` |
| `graph chain disconnect <from> <to>` | `graph chain disconnect gtr reverb` |
| `graph chain replug <from> <to> <newFrom> <newTo>` | `graph chain replug gtr reverb gtr delay` (the `gtr` cable now feeds `delay`) |

### Automation cables

A curve card has its own cables. Drag from a curve onto a knob to make that curve drive the
knob's parameter. Drag a module's event socket (for example a note-on) onto a curve card's event
plug to make that event fire the curve. Both write one `node automate` line:

```text
node automate osc "Filter Freq" sweep
```

## Placing cards

The graph lays itself out automatically. To put a card somewhere yourself, drag it by its
header and drop it. Its position is **pinned** in the graph file and the layout places only the
other cards around it.

| Command | What it does |
|---|---|
| `graph move <node> <x> [y]` | Pin a node at a point (world pixels). `graph move reverb auto` hands it back to the layout. |
| `graph organize` | Hand every node back to the automatic layout, clearing all pins. The minimap's **Organize** button runs it. |
| `graph pin <positions>` | Record the layout's own positions as pins, given as JSON `{node: {x, y}}`. It never overwrites an existing pin. |

A member of an open assembly box sits where its frame puts it and cannot be pinned on its own.
In the stack view, dragging a card does not pin it.

## Right-click menus

Right-clicking a card, a control, a rack pad or an assembly box opens a menu of the commands that
apply to it, with what was clicked already filled in. An entry that still needs an argument goes
to the command bar to finish.

On a **node**: automate a parameter, open the plugin's own window (external plugins only), delete,
unlink, fork into your library, give an engine module a folder (`module own`), replace, clone,
bypass, the alternatives and engines, the presets, add a rack tap, freeze, set a parameter,
bind a MIDI control, stack, insert, and pin.

On a **control**: automate it, set it, bind a MIDI control to it.

On an **assembly box**: delete it with its nodes, or dissolve it and keep the nodes.

On a **rack pad**: the `node tap` commands (see [Working with a node](./42-node-controls.md)).

## What the graph file looks like

```js
// graph.k7x
modules({
  deckA: ["@workspace/audio/crossfade"],
  deckB: ["@workspace/audio/crossfade#b"],
  "@workspace/audio/crossfade": ["MIX"],
  MIX: ["OUT"],
})
bypassed(["deckB"])
```

Each key is a node, and its list is where its output goes. A destination with `#port` lands on
that input. The run from `MIX` to `OUT` is the master chain: a node placed there processes the
whole mix. The full syntax is in the song file reference.
