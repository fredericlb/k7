# The YAML bridge

`src/yamlBridge.ts` lets code that speaks YAML read and write a `.k7x` file: `toYaml` gives a reader
the file's data as YAML text, and `applyYaml` takes the YAML a writer produced and applies it to
the k7x file. It is what lets a workspace switch format without rewriting every reader and writer
first (`packages/song/docs/k7xFiles.md`).

## A write applies DATA, not text

`applyYaml` never reprints the file. It compares the data before and after and turns the
difference into path edits on the k7x document — a changed leaf, an added or removed key, a list
spliced at its middle — which keep every other byte (`src/edit.ts`). Three things force that:

- **The file's form is the author's.** A chain stays a chain, an object an object, a comment where
  it was. A reprint would put back the canonical layout on every knob drag.
- **A writer's YAML says nothing about k7x.** It comes out of `toYaml`, whose layout is the
  `yaml` library's, so its text is no guide to the k7x file's; only its data is.
- **A one-value change stays a one-line change**, which is what a reviewer and live-sync expect.

The price: a writer that only rearranged YAML — reordered keys, rewrapped a list — writes nothing,
since the data did not change.

## A list edited at its middle

A list keeps its common head and tail; a middle of equal length is edited item by item, so a
changed note is one leaf; any other middle is deleted and inserted item by item, so an inserted
note is one new line rather than every note after it rewritten. Song's lists carry no ids
(`packages/live-sync/docs/ops.md`), so position is all there is to go by.

## What it costs

Measured on the largest file of the library (`surge-xt/ui.yaml`, 313 KB): k7x parses in 5 ms where
YAML takes 98; `toYaml` is 45 ms, and `applyYaml` 90 ms, most of it the `yaml` library parsing the
writer's text. A read through the bridge is therefore no slower than reading the same file as
YAML — and song's readers do not take it: they read a `.k7x` file's data straight from `parse`,
keeping `toYaml` for the writers that edit YAML text and for locating a validation issue
(`packages/song/docs/moduleCache.md`).
