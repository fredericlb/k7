# Instances — a project's uses of modules

A **module** is a thing you could use. An **instance** is one use of it, with its own
settings and its own saved plugin state. Two guitars through one amp module are two
instances; the amp is still one module.

Instances live in a **flat `instances/` folder at the project root**, and the FILE names
the instance:

```
modules/instruments/synth/module.yaml   ->  "synth"   the module
instances/lead.yaml                     ->  "lead"    one use of it
instances/pad.yaml                      ->  "pad"     another
```

A chain names an instance by that filename and nothing else:

```yaml
tracks:
  melody: [ lead ]
  pad:    [ pad ]
modules:
  lead: [ OUT ]
  pad:  [ OUT ]
```

An instance file is **the same flat struct as `module.yaml`**, vetted the same way. It may
say anything a module may say; it normally states only what it CHANGES.

## Why flat

An instance used to live beside the module it used —
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

So they come from **what the instance extends**:

```yaml
# instances/lead.yaml
extends: "@project/instruments/synth"
params:
  Filter Freq: 90
```

The loader does this by NOT setting them. `moduleResolve`'s `OWN_ONLY` list keeps a child's
own `kind`/`inputs`/`category` when it has them and inherits the parent's when it does not,
so leaving them absent is the whole mechanism — there is no instance-shaped special case in
the resolver.

An instance that extends nothing has only what it states itself. That is a legitimate shape
— a self-contained use of a plugin the engine provides, carrying its own `plugin:` block so
the project opens on a machine that has never scanned — but it has no ports, and `validate`
is what says so.

## An instance is an ordinary extender

This is the simplification the change bought, and it is worth stating plainly: an instance
is a module that extends another module and happens to live in `instances/`. Everything
that used to be special about it is gone.

One behaviour changed with it. A `ui:` written in an instance used to be **dropped whole**,
because an instance had no `extends` and the loader special-cased taking the module's grid.
It now merges per widget, like every other `extends`. A panel is still drawn for the module
and shown on every use of it (`applyUiLibrary` looks an instance up by what it extends,
since it has no ref of its own), so the ordinary case is unchanged; what changed is that an
instance that deliberately writes `ui:` is now obeyed rather than ignored.

## What lives beside an instance

Its own files, in `instances/`:

- `instances/lead.vstpreset` — the opaque plugin state for THIS use, so a UI edit on one
  never overwrites another's or the module's.
- `instances/assets/…` — the files its params name, resolved against `instances/`.

The loader records the folder on the module as `home`, because `instances/lead.vstpreset`
can no longer be rebuilt from a category and a module name the way a module's path can.

## Names are project-wide

One flat key space: a chain step naming `lead` must mean exactly one thing. So an instance
may not take the name of a module, and `createModuleInstance` refuses it up front. A file
written by hand that collides is reported as an issue rather than silently winning.

## Not covered by this

The **shared library** still files instances beside a module's `module.yaml`, keyed
`@engine/io/IN:in-2`. That is a different tree with a different purpose — `module populate`
writes one per physical interface input, and those are variants of a shared module rather
than one project's uses of it. `readModuleTree` still reads them; a chain may still name
one. Only the PROJECT's own instances moved.

## There was no migration

Deliberately. A project carrying the old layout is not read wrong — `modules/<type>/<name>/`
now yields the module and nothing else, so an old instance is simply not there, and a chain
naming `synth:lead` reports a missing module. Moving one is: create `instances/<name>.yaml`
with an `extends` naming the module, and rewrite the chain's `<module>:<instance>` to the
bare name.
