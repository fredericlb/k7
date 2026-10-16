# The chains builder

The account's library chains, edited in k7 as the graphs they are — without leaving the song.

`/chains-builder` is the list, `/chains-builder/<ref>` one chain. A screen over the layout, like
`help` and a surface screen: nothing under it unmounts, so closing it puts the song back exactly
as it was.

## Why there is no second editor

A chain template is a chain FILE, `<library>/chains/<path>.yaml` — the format a project's chains
are written in, ending at `@out` (`packages/song/docs/sharedFolders.md`). A library may also hold
FOLDER chains, `graph.yaml` with `nodes/` beside it, and the screen opens both:

| where | what it does |
|---|---|
| `GET /library-chains` | what the libraries hold — `ref` and `path`, the address a browser may hand back: the file, or a folder chain's folder |
| `src/templateGraph.ts` | a chain file drawn from its own saved text, as one run from `@in` to `@out` |
| `GET /graph?at=<path>` | a folder chain's graph, through the branch `graphDoc` already had for a non-active project |
| `POST /command { line, at }` | the verbs, pointed at a folder chain instead of the open song |

A chain file is drawn in the browser because the server's graph and its verbs read a FOLDER as a
project; until they read a chain file, the gestures on one are said to reach folder chains only
rather than run against nothing, and the file is edited as text.

`at` is a path the caller was **given**, never one it built — the rule `/module-libraries` and
`POST /module` already follow — and it goes through `safePath` like every path a browser sends.

## Getting there

Three doors, and the tab is the one you find without knowing the word:

- the **Libraries tab** of the file tree, under `@k7-core ▸ chains` — beside the shared modules
  (`@k7-core ▸ modules`) and the assembly templates (`@k7-core ▸ assemblies`), because all three come out
  of the one library folder and the `@k7-core` row IS that folder, drawn as it is on disk
  (`libraryTree.ts`). One row per chain; opening it opens the builder on that chain.
- `chains builder` in the command bar, which toggles like `help`.
- `/chains-builder`, or `/chains-builder/<ref>` — an address you can bookmark.

A chain file is a leaf row. A folder chain is a folder row with its node files under it, and the
module lookup beside it cannot tell that folder from a module's — so the chain map is asked first.

## What the screen wires

The list, and `DomChains` on the chosen chain with the patch cable, the splice and the pin
(`graph chain connect` / `disconnect` / `replug`, `graph move`). Every one of them goes through the
component's single `command`, which is the one place that knows the edit is aimed somewhere other
than the song — and it bumps a revision so the drawing re-reads the file the verb just changed.

A chain drawn without its gestures would be a picture of one.

## The text half

Beside the drawing: the chain file, or for a folder chain one tab per file — the graph, then each
node — in `@studio/ui-editor`'s YamlPane, with the autosave every text pane here runs. No Save button;
written as soon as it is a file the compiler could read.

The two halves are one chain seen twice. A verb rewrites the file under the pane showing it, so a
save bumps the same revision the gestures do and both re-read. Editing a node extends changes
what the graph draws on the next read.

## What is not wired yet

- **Gestures on a chain file.** The graph verbs and `node new` reach a folder chain only; a chain
  file is edited as text, and its drawing has no cable, splice or pin.
- **Creating a chain.** Adding a NODE to a folder chain works and is tested
  (`chainNodeNew.test.ts`). Making a new chain from nothing has no verb yet.
- **The engine.** A chain edited here is not heard. It is heard by being named in a project that
  is open — this song, or the bench's live rig when no song names it (`apps/k7/backend/docs/media/banc.md`):
  the library is mounted in both, so a plugin actually loads. This screen edits the topology in
  place; something playing is what auditions it.
