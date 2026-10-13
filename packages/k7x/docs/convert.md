# YAML → k7x

`src/fromYaml.ts` turns a YAML file into the same data written as k7x. It is what migrates the
corpus and every stored workspace ([k7x-plan.md](../../../docs/k7x-plan.md)), so its one promise is
that nothing is lost: the data reads back equal, and every comment line survives exactly once.

## Where a comment lands

The `yaml` library hangs a comment on a node, and not always the node a reader would guess:

- a comment above a collection's FIRST child belongs to the collection (`commentBefore`), whether
  that collection is an entry's value or a list item — so the converter places it once, from the
  parent, above that first child;
- a comment after a block collection's LAST child is the collection's `comment` and goes inside,
  before the closing bracket; on a flow collection or a scalar, `comment` is the rest of the line;
- the document's own leading comment becomes the file's header, followed by a blank line, since
  YAML only gives a document a leading comment when a blank line separated it from the first key.

Blank lines before an entry or an item are kept where YAML records them (`spaceBefore`).

## What is refused

Anchors and aliases, a root that is not a map, and a YAML that does not parse: k7x has no form for
the first two, and converting the third would guess. None occurs in `demos/` or `st0-library/`, and
neither do tags, multi-document files or non-string keys (the corpus test is `src/corpus.test.ts`).

## How it is checked

Over every YAML file of `demos/` and `st0-library/`: the converted text parses to the YAML's own
data, each comment line appears as many times as the YAML had it, and on the converted text every
scalar is set, every map entry deleted and every map extended (the first 40 of each per file) with
the result equal to the expected data and, for a scalar, every byte outside its span unchanged.
