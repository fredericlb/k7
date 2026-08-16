# Chains — routing templates the library holds

A **chain** in the médiathèque is a folder holding a `chains.yaml`, at whatever depth under
`chains/`:

```
chains/blindtest/vocal-strip/
  chains.yaml        ← the segments
  nodes/         ← the modules they name
    eq.yaml
    gate.yaml
```

The file is a l8 `chains.yaml` — the same name and the same shape a project uses at its
root. Not "like" it: the same parser (`@studio/song`'s `parseGraph`), the same
`deriveChains`, the same graph pipeline. A template that drifted from the format it is a
template *for* would be a second dialect to keep in step.

## `@in` and `@out`

A song's chains start at a **track** and end at a **sink**. A template has neither: it says how
to treat something, not what to treat. So it names its ends `@in` and `@out`.

`@in` is declared as the one entry under `tracks:` — literally, so the whole l8 pipeline
works unchanged. `deriveChains` follows a track's first hop exactly as it does in a song, and
`buildGraph` draws a source node for it. The chain has no tracks, but it has one thing the
signal comes FROM, and that is the same position in the graph.

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
