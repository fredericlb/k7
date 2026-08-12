# Doc modules — a note IN the graph

A note is a module. One input, no output, one field:

```yaml
# nodes/notes-amp.yaml
extends: "@studio/doc"
content: |
  Le NAM tire fort : -6 dB avant,
  sinon ça écrête sur les attaques.
```

…wired from whatever it is about, like anything else:

```yaml
# chains.yaml
modules:
  ampli: [ reverb, notes-amp ]
```

## Why it replaced the Docs panel

`docs:` and `todos:` used to sit on every module and every track, and one bottom panel read
them: a Context tab following the selection, a Global tab aggregating every to-do.

The panel was the problem. A note about a module lived **somewhere you had to go and look**,
in a list with everybody else's notes, while the thing it was about was on the graph you had
just left. So the note was written once and never read again — which is the failure mode of
documentation generally, reproduced inside the app.

A note is now a **thing in the graph**, at the point of the signal path it is about. You read it
where you already are.

## One input, no output

That is the whole shape, and both halves are load-bearing.

The **input** is what attaches it: a note is wired from the module it comments on, and the cable
is what says which one. Without it a note would be a floating card, and its subject would be
whatever it happened to be laid out near.

**No output**, because a note is where a run stops being signal. Anything downstream of a note
would be documentation feeding audio. `isSink` therefore answers yes for a doc module — a chain
routed to one terminates there, exactly as it does at `OUT` — which is a fact about its SHAPE
rather than about an io role, and is why it is asked separately from the io test.

## Every note is a node of `@studio/doc`

There is one doc module for the whole studio and it has **no file anywhere**. That makes it the
second such module in the repo, after the synthesised `@engine/…` plugins
([moduleNamespaces.md](moduleNamespaces.md)), and the first with no engine behind it either.

A note being a *node* is not a trick — it is what a node already is here: one USE of a
module with its own settings. Two notes are two nodes of one module for the same reason two
4OSCs are; their setting happens to be text rather than a number. `mergeAuthored` makes the
child win per key, so each note's `content` is its own, and `OWN_ONLY` needed no change.

The cost of the alternative is what settled it: a project-local `modules/docs/doc/module.yaml`
would have been a file every project must scaffold before its first note, and an old project
would have to create it by hand. Built in, a note costs exactly one file — its node.

`@studio` is its own namespace and not `@engine`, deliberately: the engine never hears of this.

## `kind` grew a third value

`ModuleKind` was `"io" | "plugin"`. A doc is neither, and giving it one of those two would have
been cheaper by a union member and wrong in a way that spreads: every "is this a sink" test
would answer yes about a note (including the ones deciding what a chain ENDS on), or every "does
this load a plugin" test would try to give the engine a comment.

Widening it made the compiler point at each place that assumed two. That was the point.

## Hidden by default

The button sits in the footer beside the mixer, and for the same kind of reason: both change
what the **graph** shows rather than opening a panel. Notes are off until you ask.

They are in the signal path, so drawing them always would put prose in the middle of the thing
you are trying to read — which is the old panel's failure from the other side. This is the
in-between: they are in the graph, and you say when.

Filtered in `ChainsTab`, **before** `buildGraph`, which is why it is its own memo: dagre ranks
what it is given, so hiding a node after layout would leave the hole it was laid out into. A
note is dropped from both places it can appear — a step in a chain's `use`, and the `to` of an
`out` when a run ends on one. Missing the second would draw a cable to nothing.

`graph.modules` is keyed by doc modules **and nothing else** (`graphDoc.ts`), so its keys ARE
the project's notes. That is what lets a surface find them with no second field saying which
nodes are prose, and it is what the footer button counts.

## Drawn as written

`noteSize` measures the text and tells dagre, so a note reserves real space instead of
overlapping the chain it annotates. It wraps at 320px rather than widening without limit: one
long paragraph would otherwise push every rank of the graph sideways to make room for prose.

The card is deliberately unlike every other one — dashed edge, paper tint, no header, no jacks —
so prose is never mistaken for a device. It also does **not** drop to its name at far zoom, which
every other card does: a note's text is the card, and shrinking it to the node's filename
would replace the only thing worth reading with the one thing that is not.

## Migrating

`docs:` and `todos:` are **gone from the schemas**, not deprecated. Both schemas are `.strict()`,
so a file still carrying one says so by name and by line rather than being read and dropped —
which is the outcome this repo keeps choosing (see `deadProjectFields` for the same call made
the other way, where every existing song carried the field).

Move the prose:

| it was about | put it in |
|---|---|
| the file itself — why this track is muted, what this module extends | a `#` comment, where a reader of the file looks |
| the SIGNAL — what to watch on this part of the chain | a note, wired from it |

Everything in this repo took the first road: the demo songs and the DSP modules carried
paragraphs that were really file headers, and they read better as comments.
