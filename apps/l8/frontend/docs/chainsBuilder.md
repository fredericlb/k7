# The chains builder

The account's library chains, edited in l8 as the graphs they are — without leaving the song.

`/chains-builder` is the list, `/chains-builder/<ref>` one chain. A screen over the layout, like
`help` and a surface screen: nothing under it unmounts, so closing it puts the song back exactly
as it was.

## Why there is no second editor

A chain template **is** a graph. Same parser, same derivation, same segments. Two differences, and
both are about what it *is* rather than how it is written: no `project.yaml` beside it, and ends
named `@in`/`@out` instead of a lane and a sink. Same file name, same `nodes/` beside it — a
chain is a folder laid out exactly as a project is.

So the whole feature is four small seams rather than a parallel editor:

| where | what it does |
|---|---|
| `@studio/song`'s `graphFileOf` | one name to look for, so all eight graph verbs reach a template without one of them knowing it might be one |
| `GET /library-chains` | what the library holds — `ref` (`process/normalize`) and `path`, the address a browser may hand back |
| `GET /graph?at=<path>` | that chain's graph, through the branch `graphDoc` already had for a non-active project |
| `POST /command { line, at }` | the verbs, pointed at the chain's folder instead of the open song |

`at` is a path the caller was **given**, never one it built — the rule `/module-libraries` and
`POST /module` already follow — and it goes through `safePath` like every path a browser sends.

## What the screen wires

The list, and `DomChains` on the chosen chain with the patch cable, the splice and the pin
(`graph chain connect` / `disconnect` / `replug`, `graph move`). Every one of them goes through the
component's single `command`, which is the one place that knows the edit is aimed somewhere other
than the song — and it bumps a revision so the drawing re-reads the file the verb just changed.

A chain drawn without its gestures would be a picture of one, which st0 already has
(`ChainView`, read-only, beside the YAML).

## What is not wired yet

- **Creating** a chain, and creating a node inside one. `node new` writes into `nodes/` beside the
  graph file, so it should follow the same way the others did; it is untested here.
- **Committing.** The library is a git repository (`st0-libraries`) and an edit leaves it dirty.
  Nothing in this screen publishes.
- **The engine.** A chain edited here is not heard. That is what the bench is for
  (`apps/st0/docs/banc.md`) — a real project whose `graph.yaml` is the chain, with the catalogue
  mirrored beside it so a plugin actually loads. The two are complementary: this edits the
  topology in place, the bench auditions it.
