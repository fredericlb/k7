# k7x in Rust

`rust/` is the k7x reader in Rust, and `parse` (`src/edit.ts`) reads through it on every host: the
browser, the hosted server, the desktop app, Android and iOS. It is the READER only — a file's
data — and `src/parse.ts` stays the source of truth: the tree with its spans, every edit, and the
answer whenever the Rust reader declines.

## One reader, two builds

| host | runs | why |
|---|---|---|
| a browser, the server's node, Electron's node, Termux's node | WebAssembly, `src/k7xWasm.generated.ts` | each has a JIT, so one module serves all of them — no binary per OS and CPU |
| NodeMobile on iOS | `k7x.framework`, the Node-API addon `rust/node` | a JIT-less V8 has no WebAssembly at all |

The addon is the app's ONE native library, so it also carries the waveform measure of
`@studio/audio-analysis` (`rust/node/src/waveform.rs`, `packages/audio-analysis/docs/analysis.md`):
a second framework would be a second thing to stage, embed and sign.

Both are the same C ABI, `rust/src/ffi.rs`: UTF-8 text in, **JSON text out**, which `JSON.parse`
turns into the value. That is the whole design, and it is measured: over the corpus (1,272 files),
`JSON.parse` of the data takes 5 ms with or without a JIT, where building the same objects in JS
takes 43 ms with one and 139 ms without. Handing JS a TREE is the opposite case — the tree with its
spans is 13.9 MB of JSON and parses in 43 ms, slower than `parseTree` itself with a JIT — which is
why the tree and the edits stay in TypeScript.

The addon needs no napi-rs: Node-API is a stable C ABI, and `rust/node/src/lib.rs` declares the nine
calls it makes. `rust/node/build.rs` says where those symbols come from on each platform; iOS links
NodeMobile.framework, since it cannot resolve them late. `engine/k7-ios/scripts/stage.mjs` builds it
(the `k7x` part), and `BackendHost.swift` names it in `K7X_ADDON`, which every worker inherits.

## It never changes an answer

`src/native.ts` answers what `parse.ts` would, or declines and lets `parse.ts` answer:

- **A lone surrogate** cannot be in a Rust string: a text that holds one is not sent, and one that
  escapes one (`"\uD800"`) comes back declined.
- **Numbers keep their JS value**: `-0` is written `-0` and an overflow `1e999`, both of which
  `JSON.parse` reads back as `parse.ts` would have them.
- **Spans are byte offsets** in Rust; an error's offset is converted to UTF-16 units before it
  crosses, so a `K7SyntaxError` carries the same message, offset, line and column.

`src/native.test.ts` holds that over every corpus file and every edge, and is run against both
builds (`K7X_ADDON=… vitest run src/native.test.ts` for the addon). `bench/compare.ts` checks the
whole tree, spans included, before it times anything.

`K7X_READER=js` turns the reader off; `nativeKind()` says which one a runtime ended up with.

## The module is checked in

Every host loads this package as raw TypeScript with no build step, so the WebAssembly ships as
source: `npm run build:wasm -w @studio/k7x` writes it, base64, with a hash of `rust/src`, the
manifest and the lock file. A test fails when the Rust sources no longer hash to that, so a change
to them without a rebuild cannot land. The module is 117 KB; a browser compiles it in the background
when its main thread refuses a synchronous compile, and `parse.ts` answers meanwhile.

## The tree lives in an arena

`parse_tree(text, &bump)` builds the tree in a `bumpalo::Bump` the caller owns: a key or a string is
a slice of the text unless it carries an escape, a container's children are one slice of the arena,
and no node has a destructor. The C ABI keeps one arena per thread and resets it per call. A tree of
`Vec`s and owned strings, freed node by node, measures 1.25–1.4× slower on every set below.

## What was measured

2026-10-19, Windows 11, x86-64, node 24.18, rustc 1.97 (release, LTO), bumpalo 3.20.

**What a reader gets** — the corpus's data, through `parse`:

| | node (JIT) | node `--jitless` (iOS) |
|---|---|---|
| `parse.ts` + `toJS` | 42 ms | 134 ms |
| WebAssembly + `JSON.parse` | 17 ms | — (no WebAssembly) |
| the addon + `JSON.parse` | 16 ms | 16 ms |

**The parse alone** (`npm run bench:rust`), medians in ms:

| set | node (JIT) | node --jitless | rust, `Vec` tree | rust, arena per file | rust, one arena reset |
|---|---|---|---|---|---|
| the corpus, 1272 files, 1.52 MB | 23 | 108–115 | 9.0–9.6 | 6.8 | 4.8–5.0 |
| its largest file, 0.30 MB | 6.4–8.9 | 24–26 | 2.4 | 2.0 | 1.0–1.1 |
| one synthetic file, 2.51 MB | 34 | 132–135 | 12.6 | 10.0–10.3 | 6.8 |

## Why the edits are not ported

A write's time is not k7x's. On the largest file (`surge-xt/ui.k7x`, 300 KB) one write spends
~324 ms in the `yaml` library — the writer's document, its print, and `applyYaml` parsing it back
(`docs/bridge.md`) — and 10–11 ms in k7x's own document work; a typical node file's whole write is
0.04 ms. Porting `edit.ts` and `print.ts` would buy at most that 3 %. What a write costs is the YAML
the writers still speak.
