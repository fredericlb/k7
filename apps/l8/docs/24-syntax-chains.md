# Chains

## chains.yaml

The routing graph, declared as SEGMENTS: each track and each module says where its signal goes next. Nothing declares a chain — the chains are DERIVED by following the arrows.

A run breaks in exactly two places: where the signal SPLITS (a node with two destinations), and where two signals MEET (a node several things feed) — which is what a bus is. A run fed by a track is called after that track; a run the signal joins into is called after the module it starts at. That name is an identity: it is the routing target, the bus's track, and the prefix of every plugin id under it.

```yaml schema=ChainsFile
tracks:
  melody: [ synth ]
  gtr: [ amp ]
modules:
  synth: [ OUT ]
  # `amp` feeds the reverb, which nothing else does — so the reverb is simply the
  # next module on the gtr run, not a chain of its own.
  amp: [ reverb ]
  reverb: [ convolution ]
  convolution: [ OUT ]

bypassed: [ convolution ]
```

`bypassed` lists the modules the signal passes through untouched. They keep their place and their params. A module is named ONCE in this file, so a bypass is one name appearing or disappearing — there is never a second copy to keep in step.

One node per line, its destinations as a flow sequence. That is the canonical form: a node written any other way is re-spaced by the first edit, and then every node shows up in the diff.

## What a name means

A destination is a module of this project, or an io sink like `OUT`. A key under `modules:` with an empty list is a module that is placed but wired to nothing yet — which is how a module exists between being created and being connected.

A module name is one of three things:

- `synth` — a module of this project, by the name of its folder under `modules/`.
- `lead` — one USE of a module, by the name of its file in `instances/`. An instance is
  `instances/lead.yaml`, and it says which module it uses with `extends:` — the folder is
  flat, so where the file sits tells you nothing and does not have to.
- `"@engine/audio/amp/nam"` — an INHERITED module, by its ref: the level it lives at (`@engine`, `@mediatek`, `@workspace`), then the path to it inside that level. Nothing declares those levels — they are the machine's plugin scan, the médiathèque, and the `_modules` beside the song. It arrives merged through its own `extends`, so it behaves exactly like a local one.

A ref must be QUOTED, as a key and as a destination alike. YAML reserves `@` as the first character of a plain scalar, and an unquoted one stops the file parsing — which is why picking one from the editor's completion list brings its quotes with it.

```yaml schema=ChainsFile
tracks:
  gtr: [ "@engine/audio/amp/nam" ]
modules:
  "@engine/audio/amp/nam": [ OUT ]
```

## One module, two voices

A module named once is ONE plugin. Pointing two tracks at the same name does not give each its own copy — it makes that module a bus fed by both, which is right for a shared reverb and wrong for an instrument. When each lane needs its own, give the module an instance per lane — `instances/lead.yaml` and `instances/pad.yaml`, each extending `synth`:

```yaml schema=ChainsFile
tracks:
  melody: [ lead ]
  pad: [ pad ]
modules:
  lead: [ OUT ]
  pad: [ OUT ]
```

## Live inputs

An interface input is a module too — one under `io/` with `io: in` and a `channel:`. It **feeds a track**: name the track as its destination, and the signal lands on that lane. This is the one place a track appears on the right-hand side of an arrow, and it is the only thing that may — a track's material is its clips, so anything else aimed at a lane is discarded.

```yaml schema=ChainsFile
tracks:
  # …and from the lane onward, the track's own run: through an amp, out to the mix
  gtr: [ "@engine/audio/amp/nam" ]
modules:
  # input 1 arrives on the `gtr` lane — the arrow points the way the signal travels
  "@engine/io/IN:in-1": [ gtr ]
  "@engine/audio/amp/nam": [ OUT ]
```

The module itself names no track, which is what lets `IN` come from the engine and be instanced per project: the instance carries the channel, and which track it feeds is a per-project answer. An input sitting INSIDE a track's run works too — `gtr: [ "IN:gtr" ]` — and lands on the same lane; it is what the old chain-list format could express, and the migration writes it that way.

Note `IN:in-1`, with a colon: `in-1.yaml` is an INSTANCE of the `IN` module, not a folder inside it. Two shapes that don't work, and what they say:

- an input whose run reaches no track — nothing owns the signal. Reported as `an input's signal has to land on one`, and the lane refuses to arm: `has no input — nothing to record`.
- an input at the END of a run, fed by something — routing INTO a live input is meaningless, since signal comes from it. Reported as `signal comes FROM it, not to it`.

## Migrating from the chain list

Projects written before this change hold a `chains:` list. They are read as an error naming the migration rather than as a schema complaint; run it once per project:

```bash
l8 migrate chains <project>
```

It preserves each chain's source, the order of its modules, its sink and its bypasses. Two things change on purpose. A chain's `as:` alias is gone (a chain is called after its track now), which renames the plugin ids under it. And a module the old file used in SEVERAL chains is split into one instance per chain — the list format compiled such a module to one plugin per chain, and a segment file names each module once, so leaving it shared would collapse two instruments into one.
