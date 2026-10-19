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

Three differences are deliberate:

- **Spans are byte offsets** into the UTF-8 text, where the TypeScript ones count UTF-16 units.
  `src/json.rs` converts them when it writes a tree, which is how the comparison checks them.
- **A lone surrogate escape** (`"\uD800"`) reads as U+FFFD, since a Rust string cannot hold one.
- **Keys and strings borrow from the text** (`Cow<str>`) unless they carry an escape, and every
  container is allocated once, at its size, from a scratch stack shared by the open containers.

The crate has no dependency, so a phone build is `cargo` and nothing else.

## What was measured

2026-10-19, Windows 11, x86-64, node 24.18, rustc 1.97 (release, LTO). One pass parses every
file of the set once, its text already in memory. "Cold" is a fresh process's first pass, JIT
warm-up included; "median" is over 50 passes. `node --jitless` is how V8 runs on iOS
(`engine/k7-runtime/docs/ios.md`).

| set | node (JIT) cold / median | node --jitless cold / median | rust cold / median |
|---|---|---|---|
| the corpus, 1272 files, 1.52 MB | 35 / 23 ms | 113 / 105 ms | 10 / 8.6 ms |
| its largest file, 0.30 MB | 8.9 / 6.0 ms | 26 / 23 ms | 3.0 / 2.2 ms |
| one synthetic file, 2.51 MB | 41–52 / 32 ms | 142 / 128 ms | 14 / 12 ms |

Rust is 2.6× the JIT and 10–12× the jitless interpreter. The ratio, not the milliseconds, is what
carries over to a phone; the phone numbers themselves are still to be taken.

## What is left on the table

The Rust parse runs at 135–210 MB/s, about a tenth of what a byte walk of the same text costs on
this machine. Splitting a pass showed allocation and freeing are the larger share, and Windows'
default heap is a slow one. An arena (a crate such as `bumpalo`) or a flat node table would remove
most of it; neither is in, since each is either a dependency or a different tree shape.
