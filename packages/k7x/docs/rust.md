# k7x in Rust

`rust/` is a port of `src/parse.ts` to Rust, kept to measure what a native file service would gain
on a phone. It is the parser only: no edit, no print, no YAML bridge. Nothing in the studio links it.

## Same tree, decision for decision

The crate builds the tree of `src/ast.ts`, field for field, and refuses what the TypeScript parser
refuses with the same message, line and column. `npm run bench:rust -w @studio/k7x`
(`bench/compare.ts`) holds it to that before it times anything: every file of `demos/` and
`k7-core/`, one synthetic file of the whole corpus, and a set of broken inputs, compared tree for
tree with `parseTree`'s, spans included. A mismatch fails the run, so no number is ever printed for
a parser that reads something else.

Two differences are deliberate:

- **Spans are byte offsets** into the UTF-8 text, where the TypeScript ones count UTF-16 units.
  `src/json.rs` converts them when it writes a tree, which is how the comparison checks them.
- **A lone surrogate escape** (`"\uD800"`) reads as U+FFFD, since a Rust string cannot hold one.

## The tree lives in an arena

`parse_tree(text, &bump)` builds the tree in a `bumpalo::Bump` the caller owns, and the tree
borrows from both: a key or a string is a slice of the text unless it carries an escape, a decoded
one is written into the arena, and a container's children are one slice of it, copied there once
at their final size from a scratch stack the open containers share. Every node is `Copy` and has
no destructor, so freeing a tree is dropping (or resetting) its arena.

That is the one dependency, and it is taken for what it measures: a tree of `Vec`s and owned
strings, freed node by node, is 1.25–1.4× slower on every set below, most of it in the allocator.
The cost is a lifetime — a tree cannot outlive its text or its arena — which suits a file service
that keeps a document's text and its tree together anyway.

## What was measured

2026-10-19, Windows 11, x86-64, node 24.18, rustc 1.97 (release, LTO), bumpalo 3.20. One pass
parses every file of the set once and frees its tree, the text already in memory. "Cold" is a
fresh process's first pass, JIT warm-up included; "median" is over 50 passes. `node --jitless` is
how V8 runs on iOS (`engine/k7-runtime/docs/ios.md`). Medians, in ms:

| set | node (JIT) | node --jitless | rust, `Vec` tree | rust, arena per file | rust, one arena reset |
|---|---|---|---|---|---|
| the corpus, 1272 files, 1.52 MB | 23 | 108–115 | 9.0–9.6 | 6.8 | 4.8–5.0 |
| its largest file, 0.30 MB | 6.4–8.9 | 24–26 | 2.4 | 2.0 | 1.0–1.1 |
| one synthetic file, 2.51 MB | 34 | 132–135 | 12.6 | 10.0–10.3 | 6.8 |

A cold pass is within 5–20 % of the median for an arena per file, 1.3–2× it for a reset arena (its
first pass allocates the chunks the others reuse), and 1.3–1.6× it for node's JIT.

An arena per file — what a cached document would hold — is 3.2–4.5× node's JIT and 12–17× the
jitless interpreter. A single arena reset between files, which a one-shot walk of a workspace
could use, gains 1.4–1.9× more, since its chunks are allocated once. The ratios, not the
milliseconds, are what carry over to a phone; the phone numbers themselves are still to be taken.

`K7X_BASELINE_BIN=<label>=<path>` adds another build of `k7x-bench` to the table, which is how the
`Vec` tree column was taken.
