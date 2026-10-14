# Console — one summing console over the whole mix

A project can run its mix through an Airwindows-style **console**: a CHANNEL plugin on every lane
and a BUSS plugin on the sum. The two halves are one system, so the project names the system once:

```yaml
# project.yaml
project:
  console: "@k7-core/console/console-6"
```

A system is a folder of a library's `console/` type, holding exactly two modules:

```
<library>/modules/console/<system>/
  channel/   module.yaml, ui.yaml
  buss/      module.yaml, ui.yaml
```

## Why a project setting and not two modules

A console's channel ENCODES each lane so that summing behaves like an analogue desk, and its buss
DECODES the sum. They are a matched pair: Console 5's channel into Console 6's buss, or a channel
with no buss at all, is a distortion nobody chose. As modules, the two halves were 16 entries in
the picker that only worked when placed by hand on every lane plus the master, from the same
generation. One setting cannot be half-applied or mismatched, which is the whole reason it is one.

So the halves are **never offered as modules**. `baseModuleRefs` and the chain completions leave out
the `console` type, the way they leave out an engine. They stay modules on disk all the same: the
builder edits their panels, and a library can add a system by adding a folder.

The system is named by REF (`@<library>/console/<system>`) and not by a bare name, so two libraries
can each ship one, and a project says which.

## Where the halves go

The compile places them on the finished document (`withConsole`, after `compileNodeProjectIn` has
built it):

- **The channel goes after each lane's strip.** The strip is the lane's level and pan
  ([trackMixer.md](trackMixer.md)), and the encode must see the level the lane is summed at. A lane
  with no strip gets the channel last.
- **The buss goes first on the master chain**, before any master processing, which must treat the
  decoded sum ([masterChain.md](masterChain.md)).

Two kinds of track get **no channel**:

- **A lane leaving by CUE** never reaches the main sum ([cue.md](cue.md)). Its headphone feed stays
  as it is.
- **A bus return** receives what its senders already encoded; a second encode on the way out would
  compound. Its own effects therefore work on an encoded signal. That compromise is known and
  accepted: the alternative is a decode and re-encode around every bus.

Groups need nothing: they are drawing only and the engine sums every lane into the master directly.

The halves' plugin ids start with `@console:`, which no chain step can produce, since `@` begins a
ref and never a node name.

## Implicit

Choosing a console never touches `graph.yaml`: the halves are not nodes, and the graph you drew
stays the graph you drew. The graph does not draw it either: which console a project runs is a
setting of the project (Settings › Project), and that is where it is read and changed. A tag on
every strip and on the `MIX` sum would repeat one fact across the whole graph.

## A system that is not there

`project.console` naming a system the account's libraries do not hold stops the compile, like any
unresolved `extends`. Silently dropping it would play the mix without the console, which sounds
like a different mix rather than like an error.

## Choosing one

`project console <system>` writes it, `project console none` removes it, and a bare
`project console` lists what the libraries hold. The settings panel's **Project** tab is a dropdown
running the same verb. A system appears there only when its folder has BOTH halves.
