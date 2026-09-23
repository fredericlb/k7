# The chains builder

The account's library chains, edited in st0 as the graphs they are — without leaving the song.

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

## Getting there

Three doors, and the tab is the one you find without knowing the word:

- the **Libraries tab** of the file tree, under `@st0 ▸ chains` — beside the shared modules
  (`@st0 ▸ modules`) and the assembly templates (`@st0 ▸ assemblies`), because all three come out
  of the one library repository and the `@st0` row IS that repository, drawn as it is on disk
  (`libraryTree.ts`). One row per chain; opening it opens the builder on that chain.
- `chains builder` in the command bar, which toggles like `help`.
- `/chains-builder`, or `/chains-builder/<ref>` — an address you can bookmark.

A chain row is a
LEAF though a chain is a folder on disk: what the tab offers is the chain, not its files, and the
module lookup beside it cannot tell the two folders apart — so the chain map is asked first.

## What the screen wires

The list, and `DomChains` on the chosen chain with the patch cable, the splice and the pin
(`graph chain connect` / `disconnect` / `replug`, `graph move`). Every one of them goes through the
component's single `command`, which is the one place that knows the edit is aimed somewhere other
than the song — and it bumps a revision so the drawing re-reads the file the verb just changed.

A chain drawn without its gestures would be a picture of one, which pl8 already has
(`ChainView`, read-only, beside the YAML).

## The text half

Beside the drawing: one tab per file — the chain graph, then each node — in the repo own YamlPane,
with the autosave every text pane here runs. No Save button; written as soon as it is a file the
compiler could read.

The two halves are one chain seen twice. A verb rewrites the file under the pane showing it, so a
save bumps the same revision the gestures do and both re-read. Editing a node extends changes
what the graph draws on the next read.

## What is not wired yet

- **Creating a chain.** Adding a NODE to one works and is tested (`chainNodeNew.test.ts`): pointed
  at a template, `node new` writes into that chain's own `nodes/` and puts the node in its graph.
  Making a new chain from nothing has no verb yet.
- **Committing.** The library is a git repository (`pl8-libraries`) and an edit leaves it dirty.
  Nothing in this screen publishes.
- **The engine.** A chain edited here is not heard. It is heard by being named in a project that
  is open — this song, or the bench's live rig when no song names it (`apps/pl8/docs/banc.md`):
  the library is mounted in both, so a plugin actually loads. This screen edits the topology in
  place; something playing is what auditions it.
