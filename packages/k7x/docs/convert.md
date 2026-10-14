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

## The author's layout is kept where it was a choice

A collection YAML writes on one line — `{ type: knob, col: 0, bind: Mix }`, `[ lead ]` — stays on one
line in k7x, however wide. A panel holds a widget per line on purpose, a row being what a person
scans; breaking each at 100 columns turns a 60-line panel into 500, and the library as a whole
grew five times over under that rule.

A collection YAML writes across lines is laid out by the printer: broken past 100 columns, joined
when it fits. That one is not kept, because block style is often no choice at all: song's writers
emit every note as three lines (`t:`, `d:`, `k:`), and a k7x note reads as one, `t(0).d(1).k(60)`.

## What is refused

Anchors and aliases, a root that is not a map, and a YAML that does not parse: k7x has no form for
the first two, and converting the third would guess. None occurs in `demos/` or `k7-core/`, and
neither do tags, multi-document files or non-string keys (the corpus test is `src/corpus.test.ts`).

## How it is checked

Over every YAML file of `demos/` and `k7-core/`: the converted text parses to the YAML's own
data, each comment line appears as many times as the YAML had it, and on the converted text every
scalar is set, every map entry deleted and every map extended (the first 40 of each per file) with
the result equal to the expected data and, for a scalar, every byte outside its span unchanged.
