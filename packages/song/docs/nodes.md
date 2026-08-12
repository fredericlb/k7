# Nodes — a project's uses of modules

A **module** is a thing you could use. A **node** is one use of it, with its own
settings and its own saved plugin state. Two guitars through one amp module are two
nodes; the amp is still one module.

Nodes live in a **flat `nodes/` folder at the project root**, and the FILE names
the node:

```
modules/instruments/synth/module.yaml   ->  "synth"   the module
nodes/lead.yaml                         ->  "lead"    one use of it
nodes/pad.yaml                          ->  "pad"     another
```

A chain names a node by that filename and nothing else:

```yaml
modules:
  melody: [ synth-melody ]
  pad:    [ synth-pad ]
  synth-melody: [ OUT ]
  synth-pad:    [ OUT ]
```

`melody` and `pad` are nodes too — a LANE is a node of a `@studio/…-track` module
([trackModules.md](trackModules.md)), which is why the file has one map and why the synths are
named for the lanes they serve rather than after them.

A node file is **the same flat struct as `module.yaml`**, vetted the same way. It may
say anything a module may say; it normally states only what it CHANGES.

## Why flat

A node used to live beside the module it used —
`modules/instruments/synth/lead.yaml`, keyed `synth:lead`. That meant the layout of a
project's uses mirrored the layout of the things it used, and it bought nothing: the folder
was doing the job `extends` already does, less explicitly. Two consequences of dropping it:

- **A project's uses are one folder you can read.** They used to be leaves scattered across
  the module tree, and nothing showed you the set.
- **A use of a module you do not own needs no local folder for it.** Using a médiathèque
  module meant creating `modules/<type>/<its name>/` just to hold the use.

## Where the type comes from

This is the part the folder was really carrying. `kind`, `inputs` and `category` used to be
read off the path — `modules/audio/…` is an effect taking audio, `modules/instruments/…`
takes MIDI and gives back audio. A flat folder has no such path.

So they come from **what the node extends**:

```yaml
# nodes/lead.yaml
extends: "@project/instruments/synth"
params:
  Filter Freq: 90
```

The loader does this by NOT setting them. `moduleResolve`'s `OWN_ONLY` list keeps a child's
own `kind`/`inputs`/`category` when it has them and inherits the parent's when it does not,
so leaving them absent is the whole mechanism — there is no node-shaped special case in
the resolver.

A node that extends nothing has only what it states itself. That is a legitimate shape
— a self-contained use of a plugin the engine provides, carrying its own `plugin:` block so
the project opens on a machine that has never scanned — but it has no ports, and `validate`
is what says so.

## A node is an ordinary extender

This is the simplification the change bought, and it is worth stating plainly: a node
is a module that extends another module and happens to live in `nodes/`. Everything
that used to be special about it is gone.

One behaviour changed with it. A `ui:` written in a node used to be **dropped whole**,
because a node had no `extends` and the loader special-cased taking the module's grid.
It now merges per widget, like every other `extends`. A panel is still drawn for the module
and shown on every use of it (`applyUiLibrary` looks a node up by what it extends,
since it has no ref of its own), so the ordinary case is unchanged; what changed is that a
node that deliberately writes `ui:` is now obeyed rather than ignored.

## What lives beside a node

Its own files, in `nodes/`:

- `nodes/lead.vstpreset` — the opaque plugin state for THIS use, so a UI edit on one
  never overwrites another's or the module's.
- `nodes/assets/…` — the files its params name, resolved against `nodes/`.

The loader records the folder on the module as `home`, because `nodes/lead.vstpreset`
can no longer be rebuilt from a category and a module name the way a module's path can.

## Names are project-wide

One flat key space: a chain step naming `lead` must mean exactly one thing. So a node
may not take the name of a module, and `createNode` refuses it up front. A file
written by hand that collides is reported as an issue rather than silently winning.

## Instancing one from `module insert` / `module place`

Both take two trailing optionals — `[extends-ref] [node]` — and they are told apart by
SHAPE when only one is given (a ref has a slash or an `@`), which is what lets you name a
node without inventing a ref. With BOTH given they are positional, and that is where the
hole was: a module the project already has plus an `extends-ref` was refused outright, so
naming a node of it meant also passing a ref, and passing a ref is what the refusal was
about. Reusing a module you already have — the ordinary case — had no spelling at all.

A node name now makes the ref **redundant rather than contradictory**: it says "use the
module that is already there, under this name". Two refusals remain, and both are real:

- a ref with **no node** to justify it — there is nothing to do with it but ignore it, and
  ignoring what someone typed is how a command lies;
- a ref that **disagrees** with what the module already extends. Instancing cannot re-parent a
  module, so proceeding would silently drop the parent that was asked for. The message names
  the one it actually has.

## Taking one back out — `node unlink`

`node unlink <name>` removes a node from the chains and **joins what fed it to what
it fed**, so the run closes over the gap instead of going quiet. Its files are untouched.

That last clause is the whole reason it exists beside `module delete`. Taking a module out of
the signal path and getting rid of it are two different intentions, and only the second had a
command — so "mute this out of the chain for a moment" meant deleting a node and losing its
settings. Unlinked, it is still on disk with everything it had, and `chain add` puts it back.

The splice itself is `removeNode`'s, the same one `module delete` uses; a node fed from two
paths has both of them rejoined. A **lane** used to be refused here — a chain started at it, so
there was nothing feeding it to reconnect to what it feeds. A lane is a module now
([trackModules.md](trackModules.md)), so it unlinks like anything else: it leaves the signal path
and its file stays on disk with its clips, which is what unlinking means everywhere else.

Right-clicking a module in l8's graph offers it, along with everything else a module answers —
that menu is derived from this catalogue, so the entry exists because the command's first
argument names a module and for no other reason. It survives on a **dangling** node too, where
it is the actual repair: a step naming a module that does not exist has no file to open and no
param to set, but removing it and closing the gap needs no module to exist. That last part the
catalogue cannot say, and l8 lists it (`apps/l8/frontend/docs/contextMenu.md`).

## Not covered by this

The **shared library** still files nodes beside a module's `module.yaml`, keyed
`@engine/io/IN:in-2`. That is a different tree with a different purpose — `module populate`
writes one per physical interface input, and those are variants of a shared module rather
than one project's uses of it. `readModuleTree` still reads them; a chain may still name
one. Only the PROJECT's own nodes moved.

## There was no migration

Deliberately. A project carrying the old layout is not read wrong — `modules/<type>/<name>/`
now yields the module and nothing else, so an old node is simply not there, and a chain
naming `synth:lead` reports a missing module. Moving one is: create `nodes/<name>.yaml`
with an `extends` naming the module, and rewrite the chain's `<module>:<node>` to the
bare name.
