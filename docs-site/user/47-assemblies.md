# Assemblies

An **assembly** is a group of nodes drawn as one box in the chains view. A turntable, for
instance, is a deck, four stems, a channel strip and two fades: eighteen nodes that you think of
as one appliance. Put in the graph as an assembly, they appear as a single **Turntable** box with
the few controls a hand actually reaches for.

An assembly changes only the drawing. The nodes inside it are ordinary nodes of your project:
they play exactly as they would without the box, and every command that works on a node works on
them.

## Adding one

An assembly comes from a **template** in a library's `assemblies/` folder.

```text
assembly new @k7-core/turntable turntableA
```

This copies every node of the template into your project, named `<name>_<member>`
(`turntableA_eq`, `turntableA_fade`...), copies the template's wiring with the names swapped, and
records the box. A second box from the same template shares nothing with the first but its shape.

The name uses letters, digits, `_` and `-`. A name that would clash with an existing node is
refused, and so is an assembly in a chain project.

## The box

**Closed**, the box replaces its members on the graph. It shows:

- one knob per **promoted** parameter, set by the template (the turntable promotes Trim, Low,
  Mid, High, Filter, Level, Echo and Fade);
- its **plugs**: the inputs and outputs the template declares, which you wire like any jack.

**Open**, the members are drawn inside a titled frame, and you can reach every control of every
node. The button in the box's corner opens and closes it. Whether a box is open is remembered for
your session only; nothing is written to the project.

## Removing one

Right-click the box:

| Command | What it does |
|---|---|
| `assembly delete <name>` | Delete the box and every node it holds. |
| `assembly dissolve <name>` | Stop drawing the box, leaving every node on the graph. |

Renaming a member node keeps it in its box.

## Writing a template

A template is a folder under a library's `assemblies/`, holding an `assembly.k7x`, a `graph.k7x`
and a `nodes/` folder, exactly like a small project. Its ref is the library and the folder path:
`k7-core/assemblies/turntable/` is `@k7-core/turntable`.

```js
// assembly.k7x
label("Turntable")
inputs([])
outputs([
  name("mix").type("audio").node("fade"),
  name("cue").type("audio").node("cue"),
])
params({
  Trim: { node: "trim", param: "Trim" },
  Low: { node: "eq", param: "Low-shelf gain" },
  Fade: { node: "fade", param: "Level" },
})
```

| Field | Meaning |
|---|---|
| `label` | The box's title. Without it, the instance's own name. |
| `inputs`, `outputs` | The plugs: each has a `name`, a `type` (`audio`, `midi` or `video`), the member `node` it stands for, and optionally that node's `port` and `mandatory`. Plug names are unique on each side. |
| `params` | The promoted parameters: the knob's name on the box, and the member `node` and `param` it writes. |

The template's `graph.k7x` wires the members by their template names; `nodes/` holds one file per
member. Open a template with `ui assembly <ref>` to edit it in the builder: a table lists every
member's parameters, with a checkbox to promote one onto the box.

If a project names a template that no longer exists, the box is still drawn from its members, with
no plugs, and a warning.
