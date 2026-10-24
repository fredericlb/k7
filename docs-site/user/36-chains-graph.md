# Chains and the graph

Routing — which node feeds which — is written either as **chain files** (the chain layout, a
`chains/` folder) or as **segments** in `graph.k7x` (the graph layout). A project uses one or the
other; when `chains/` exists, `graph.k7x` is not read. The Chains tab draws both the same way.

## Built-in ends

These names are not files; they are the fixed points every project routes to.

| Name | What it is |
|---|---|
| `MIX` | The mixer's sum: where every lane ends. A chain may also *start* at `MIX`; that chain is the master chain. |
| `OUT` | The audio interface. The run `MIX → OUT` carries the song's output level. |
| `RENDER` | Where picture lanes are composited (projects with a viewport). A chain may start at it. |
| `VIDEO_OUT` | The frame that leaves. |
| `CUE` | The headphone bus, which leaves the mixer's sum entirely. |
| `@out` | A library chain template's own exit. |

## Chain files: `chains/<name>.k7x`

A chain is an ordered list of **steps**. The signal enters at the first step, passes each step in
turn, and the last step may say where it goes next.

```k7x
// chains/drums.k7x — a lane into the mix and into a shader's side input
start(true)
steps([
  id("32ed90b2").track("drums"),
  id("5f1a77c0").extends("@k7-core/audio/compressor").params({ Threshold: -18 }),
  to([chain("MIX").level(1), chain("glow").port("audio").level(0.5)]),
])
```

```js
// chains/master.k7x — the master chain: from the mix sum to the interface
start("MIX")
steps([to([chain("OUT")])])
```

### Chain fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `start` | `true`, `MIX` or `RENDER` | absent | `true`: the chain starts at its own first node, a source (a lane, an input, a camera, a shape). `MIX`/`RENDER`: it starts at that sum. Absent: it is fed by other chains linking to it. |
| `ports` | list of names | none | For a chain without `start`: the input ports other chains link into. Each feeds the first node's input of that name. Refused on a chain with a `start`. |
| `bus_only` | true/false | `false` | Heard only through what it links to; its direct path to the sum is removed. |
| `hidden` | true/false | `false` | Set aside: compiled, drawn and played by nothing, and left alone by every writer. |
| `steps` | list | empty | The steps, below. |
| `subchains` | list of `{ id, steps }` | none | Chains inside this chain. See below. |

A chain without a start that nothing links to is treated as hidden, unless something places it.

### Steps

| A step is… | Written | Meaning |
|---|---|---|
| a node | `{ id, extends?, params?, … }` | One module use; its fields are those of [Node and module fields](./35-node-fields.md). |
| a lane | `{ id, track: <lane> }` | A lane, whose events are in `tracks/<lane>.k7x` — an audio lane, or a picture lane when that file extends `@meta/picture-track`. A source: only a chain with `start: true` may hold one. `bypass: true` mutes it (hides a picture lane). |
| parallel nodes | a list of two or more items | Nodes side by side, all fed the same signal. |
| a subchain run | `{ sub: <id> }` | Runs one of this file's subchains in place, its output returning to the next step. |
| links | `{ to: [ … ] }` | The last step: where the signal goes. |

Rules, each reported on the line that breaks it:

- The first step is a single item (not a parallel step, not a subchain run): its ports are what the
  chain is linked into.
- A `to:` step can only be the last.
- With several links, every link carries a `level`.

### Links

Each entry of `to:` is:

| Field | Type | Meaning |
|---|---|---|
| `chain` | text, required | Another chain's name, or a built-in end. |
| `port` | text | Which of the target chain's `ports` to enter by. |
| `level` | number ≥ 0 | The send level; required when there are several links. |

### Subchains

A subchain is a list of steps under an `id`, inside a chain file. It is used in two ways:

- **Run in place** by a `{ sub: id }` step of its parent. It must hold at least one node, end with no
  `to:`, be run once, and not be linked to.
- **Linked to** by the parent's or a sibling's `to:` (a separate branch), or named by something
  else, such as a picture fade's `chain` or a rack's `tap_outs`.

A subchain holds no lane, runs no subchain of its own (they are one level deep), and links only to
its siblings or to a built-in end. Its `id` cannot be a built-in end's name.

## The graph layout: `graph.k7x` and `nodes/`

In the graph layout each node is a file in `nodes/`, and `graph.k7x` says, for each node, where its
signal goes next. The chains are derived by following the arrows: a run breaks where the signal
splits, and where two signals meet.

```k7x
// graph.k7x
modules({
  melody: ["synth-melody"],
  "pad#midi": ["synth-pad"],
  synth-melody: ["MIX"],
  synth-pad: ["MIX"],
  MIX: ["OUT"],
})
bypassed(["pad"])
```

| Field | Type | Meaning |
|---|---|---|
| `modules` | map of node → list of destinations | Each node's next hop(s), lanes included. A destination may name a port: `glow#audio`. `[]` is a node not wired yet. A key may name the output it leaves by: `pad#midi`. |
| `bypassed` | list of node names | Nodes the signal passes through untouched; on a lane, its mute. |
| `bus_only` | list of node names | Buses heard only through their destinations. |
| `tap_feeds` | list of `{ node, tap, to }` | Runs fed by one pad (`tap`) of a rack `node`, starting at node `to`. |
| `positions` | map of node → `{ x, y }` | Where cards sit on the graph. Cosmetic. |

A port reference is `<node>#<port>`; neither half may be empty.

In a `graph.k7x` file you may also write whole runs with `runs`, which k7 expands into `modules`:

```js
runs([
  ["melody", "synth-melody", "MIX"],
  ["MIX", "OUT"],
])
```

## layout.k7x

In the chain layout, card positions live in a separate file so that moving a card never touches a
chain:

```k7x
positions({ drums: { x: 120, y: 40 }, "5f1a77c0": { x: 320, y: 40 } })
```

Keys are lane names or node ids. k7 writes one card per line and removes the file when it is empty.

## Errors you may see

| Message | Meaning |
|---|---|
| `invalid chains: …` | A chain file failed its rules; the lines after it name each problem. |
| `a lane is a source: only a chain with \`start: true\` holds one` | A `track:` item in a chain without `start: true`. |
| `a chain with a start is linked into by nothing, so it has no ports` | `ports` beside `start`. |
| `this chain has no subchain "x"` | A `{ sub: x }` naming no subchain. |
| `chain 'c' step 2 (module 'm'): port 'in' expects audio but source 'pad' is midi` | A connection between incompatible ports. |
| `… feeds 0 input(s) but 1 mandatory port(s) required` | A module whose required input is not fed. |
| `a port ref is \`<module>#<port>\` — neither half may be empty` | A malformed `#` reference in `graph.k7x`. |
