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

## `node …` and `module …` — which verb is which

The first word of a command says **what it addresses**, and the split follows the sentence at
the top of this page: a module is a thing you could use, a node is one use of it.

| | |
|---|---|
| `node new` `node delete` `graph unlink` `node insert` `graph move` | where a use sits in the chains |
| `node bypass` `node freeze` | what a use does to the signal passing through it |
| `node param` `node replace` `node alternative …` | how one use is set, what it plays, which of its settings is on |
| `module new` `module clone` `module own` | the thing itself — created, copied, given a folder |
| `module cc` | what every use of it inherits: its MIDI map |

Eight of the first list were `module …` verbs, which read as edits to the definition and were
not: `node bypass` writes a name into `graph.yaml`, and a chain names nodes. `node param
lead "Filter Freq" 69` sets **this** use; the synth two lanes over is untouched.

The completion draws the same line. The `nodes` provider offers the project's uses and nothing
else, where `modules` also offers the `@refs` a shared definition is named by — and **editing a
shared definition is the builder's job**, not a verb's: a `node …` line must never write a file
another project reads. A block in the graph is both, so its right-click menu asks both
providers, uses first.

## Making one, and wiring it

**Every node is in the graph.** A node file with no entry in `graph.yaml` is loaded by the
project and drawn nowhere — the blocks come off the chains — so a node that existed and was on
no screen was not a state worth being able to reach. `node new <category>/<name> <node> [x,y]`
therefore writes the file *and* names the node in the graph, wired to nothing
(`modules: { <node>: [] }`), at the click when the web sends one.

`module new <category>/<name> [extends-ref]` writes the module and **only** the module. It used
to take a trailing node name and make one in the same breath, which is why the graph's `+` could
send a single line — but a module and a USE of it are two things, and a chain names the use. A
module that is already there is not an error: it is the ordinary second pick of the same thing.

WIRING is separate again, and it is one verb: `node insert <before> <after> <node>` splices a
node into an arrow. There is no verb for "put this node on the canvas" any more — `node place`
was it, and both of its reasons went away: `node new` places what it makes, and `graph unlink`
leaves what it unlinks. Moving one is `graph move`.

The two wiring verbs used to create as well — each took a `<category>/<name>` and made the
module first. That is what made `node insert` indistinguishable from `chain add`, which did
this same splice on a module already there: one act, told apart only by whether a file had to
be written on the way. `chain add` is gone, and its half is what `node insert` now IS.

So the graph's `+` runs `node new <type>/<name> <node>`. For a pick from a CATALOGUE the shell
runs a `module new` ahead of it, because `node new` instances a module that exists and a
catalogue pick has no local folder yet; for a module this project already has, that step is
absent and the gesture is one line. See `nodeInsert.ts` in st0's frontend.

## A node names itself

It used to end in the command bar with the cursor after that trailing space, because the node's
NAME was the one thing only a person could supply. It is derived now:

```
<lane>_<module>_<n>        vo_jo_reverb_1, and the next one on that lane vo_jo_reverb_2
<module>_<n>               reverb_1 — no lane to be named after
```

Three places mint one and they share the rule, `instanceName.ts`: the graph's `+`, a `node new`
typed with no name, and the file tree's **New node**. A forked module is named the same way and
always was (`moduleFork.ts`) — that is where the shape comes from, and folding it into one
function is what stopped it being two rules that happened to agree.

Three things about it are deliberate:

- **The counter is on the first one too.** `vo_reverb` and `vo_reverb_2` would read as different
  kinds of thing rather than as the first and second of a series, and renaming the first to make
  room for a sibling breaks every chain that spelled it.
- **It takes the first FREE number**, not the one after the count, and it dodges MODULE names as
  well as node names — the name is one flat key, so `createNode` refuses either collision.
- **The lane is dropped when there is none.** A node dropped on the bare canvas is in the graph
  wired to nothing, so there is no run for it to be named after yet. It is not renamed when one
  arrives: a name that moves is a name every chain has to be rewritten around.

The lane is read off the ARROW, which is why the graph's `+` spells the whole name out and
`node new` on its own cannot: only the browser knows which arrow was clicked, and only with the
chains around it does that arrow name a lane. The verb still takes a name for anyone who wants
to choose one.

### …and it follows the module it extends

`node replace` swaps what a node extends. A node still called `vo_jo_reverb_1` while it extends a
delay is a name that lies about the one thing a name here carries, so the verb renames it —
`vo_jo_delay_1` — and every chain step, its file and its preset follow.

**Only when the name was OURS to move.** `renamedInstance` is the judgement, and it is the same
rule that made the name: a name this convention could have produced from the old module is one
nobody chose, and a node somebody called `wash` means `wash`. Renaming that would rewrite every
chain that spells it in order to undo a decision.

Four things it declines to do, each for its own reason:

| | why |
|---|---|
| a name with no counter, or one that is not digits | not a name this convention made |
| a name built from a DIFFERENT module | it says nothing about what the node should be called now |
| the module's leaf did not change (`@st0/audio/reverb` → `@project/audio/reverb`) | a different module, the same word — nothing to follow |
| a name a `surfaces/` **mapping** points at | see below |

The mapping is the only place outside `graph.yaml` where a node's name is a REFERENCE, and
nothing writes one back. A desk pointing at a name that has moved loses its knob silently: the
screen still draws, the control does nothing. So the rename declines and names the file holding
the name (`surfacesNaming`).

The counter is not carried over — `vo_jo_reverb_2` becomes `vo_jo_delay_1`, because the number
counts uses of THAT module and there is one of the new one.

And the rename is the SECOND act. `setModuleExtends` writes one line of one file and cannot fail
halfway; moving a name touches the file, the preset and every chain step that spells it. If the
rename declines, the replacement still stands — a node with a stale name plays correctly, and a
half-done rename does not.

One refusal remains on `module new`, and it is real: an `extends-ref` that **disagrees** with
what the module already extends. Asking for it again cannot re-parent it, so proceeding would
silently drop the parent that was asked for. The message names the one it actually has.

## Taking one back out — `graph unlink`

`graph unlink <name>` takes a node out of the SIGNAL PATH and **joins what fed it to what
it fed**, so the run closes over the gap instead of going quiet. Its files are untouched, and so
is its place on the canvas: the entry stays as `modules: { <name>: [] }`, with its pin and its
bypass. Every node is in the graph, and a verb about cables should not make one disappear.

Deleting one outright — the file, the preset, the entry, the pin — is `node delete`. Same splice,
and then it is gone. The MODULE it uses is left alone either way: a node is one use of one, and
other projects read the same module.

That last clause is the whole reason it exists. Taking a module out of the signal path and
getting rid of it are two different intentions, and for a while only the second had a command
(`module delete`, now gone) — so "mute this out of the chain for a moment" meant deleting a node
and losing its settings. Unlinked, it is still on disk with everything it had, and `node insert`
puts it back.

The splice itself is `removeNode`'s; a node fed from two paths has both of them rejoined. A **lane** used to be refused here — a chain started at it, so
there was nothing feeding it to reconnect to what it feeds. A lane is a module now
([trackModules.md](trackModules.md)), so it unlinks like anything else: it leaves the signal path
and its file stays on disk with its clips, which is what unlinking means everywhere else.

Right-clicking a module in st0's graph offers it, along with everything else a module answers —
that menu is derived from this catalogue, so the entry exists because the command's first
argument names a module and for no other reason. It survives on a **dangling** node too, where
it is the actual repair: a step naming a module that does not exist has no file to open and no
param to set, but removing it and closing the gap needs no module to exist. That last part the
catalogue cannot say, and st0 lists it (`apps/st0/frontend/docs/contextMenu.md`).

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
