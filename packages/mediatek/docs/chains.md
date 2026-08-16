# Chains — routing templates the library holds

A **chain** in the médiathèque is a folder holding a `graph.yaml`, at whatever depth under
`chains/`:

```
chains/blindtest/vocal-strip/
  graph.yaml     ← the segments
  nodes/         ← the modules they name
    eq.yaml
    gate.yaml
```

**A chain is a folder, laid out exactly as a project is.** Same file name, same `nodes/` beside
it, same parser (`@studio/song`'s `parseGraph`), same `deriveChains`, same graph pipeline. It is
not a lookalike and not a second dialect: it is the same document, and it differs in two things
only, both about what it *is* rather than how it is written — it has no `project.yaml` beside it,
and it names its ends `@in`/`@out` instead of a lane and a sink.

That homogeneity is what lets l8's graph editor edit one with no special case anywhere: every
graph verb goes through a single `graphFileOf`, and it has one name to look for. See
[apps/l8/frontend/docs/chainsBuilder.md](../../../apps/l8/frontend/docs/chainsBuilder.md).

> It was not always so, and the two names cost more than they bought. The file was `chains.yaml`
> and the folder `instances/`, on the argument that a shared chain is a different object from a
> project's topology. The argument was true and irrelevant: what a thing IS did not make it a
> different SHAPE, and the second spelling had to be carried by every reader — a fallback in the
> editor, a constant of its own in this package, a branch in the walk. Migrated, all 18 of them,
> and the fallback deleted rather than extended.

## `@in` and `@out`

A song's chains start at a **track** and end at a **sink**. A template has neither: it says how
to treat something, not what to treat. So it names its ends `@in` and `@out`.

`@in` is declared as the one entry under `tracks:` — literally, so the whole l8 pipeline
works unchanged. `deriveChains` follows a track's first hop exactly as it does in a song, and
`buildGraph` draws a source node for it. The chain has no tracks, but it has one thing the
signal comes FROM, and that is the same position in the graph.

> **Measured, and it disagrees.** Through `chainSteps` — the reading `clip process` and
> `track process` use — a file declaring `@in` under `tracks:` yields **no steps at all**, while
> one declaring it under `modules:` yields them. The `blindtest/` chains are written the first
> way and `live/vocals` the second, so the two shapes are both in the library today. Only the
> bouncing path was measured; whether z0's variant path reads the `tracks:` form successfully is
> a separate question that was not tested. A chain meant to be bounced through must use
> `modules:` until this is settled — see `chains/process/normalize`.

## The nodes are files

The segments wire named nodes to each other, and those nodes are `.yaml` files in
`nodes/` beside the chains file — each one `extends` a module from the library. A template
is therefore self-contained: the wiring and the settings travel together, the way a module's
folder carries its assets.

## What a chain is FOR is not recorded

A chain has no `kind` of its own, which is why the scan gives every one of them `kind: "chain"`.
Three things reach for these — l8 creates a track from one, z0 treats a song with
one, m9 applies one to the deck output — and none of that is a property of the chain. Filing
them by intended use would have made a template usable in one place only, which is the opposite
of what a template is.

## Applied to a song

A song's sidecar may name one as a variant; see `docs/variants.md`. The template's generic
`@in` then becomes that song's master file — the `io: file` input of `@studio/song`
(`docs/fileInput.md`) — and the drawing says which file goes through the chain rather than
repeating the placeholder.
