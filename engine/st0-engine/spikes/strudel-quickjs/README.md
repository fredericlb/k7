# Spike — Strudel inside the engine, on QuickJS

The question: can the engine evaluate and query `.strudel` patterns itself, so the pattern clock
stops being a Node process across a tunnel from the thing that plays its notes? The answer this
spike gives is **yes, with identical events and a cost the engine will not notice**.

It stands alone rather than in `tests/` because nothing in it needs JUCE or Tracktion, and a
configure that fetches neither takes seconds. Whether `StrudelHost` joins the fast test binary is
the integration's call.

## Run it

```
node engine/st0-engine/spikes/strudel-quickjs/js/bundle.mjs    # build/strudel.bundle.js
node engine/st0-engine/spikes/strudel-quickjs/js/golden.mjs    # build/golden.json, from Node
cd engine/st0-engine/spikes/strudel-quickjs
cmake -S . -B build/cmake -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build build/cmake
./build/cmake/strudel_qjs .
```

## What it measured (M-series Mac, Release, quickjs-ng v0.17.0, @strudel/* 1.1.0)

| | |
|---|---|
| events vs Node | **identical** for all 9 corpus patterns, 3 windows each (whole cycle, 8 cycles, a half-cycle slice) |
| events vs the production path | identical — `song-strudel`'s own `loadPattern`, unbundled, gives the same golden file |
| bundle | 352 KiB minified (core + mini + transpiler) |
| binary | 1.2 MB, spike executable with QuickJS statically linked |
| boot (runtime + bundle) | 34 ms, 2.0 MiB heap |
| pattern load (transpile + evaluate) | 0.6 – 3 ms |
| clock-shaped query (0.075 cycle) | mean 0.19 ms, p99 0.62 ms, **max 28 ms**, heap flat at 2.3 MiB over 20 000 queries |
| runaway `while (true)` | interrupted at the 100 ms deadline, runtime reusable |
| allocation bomb | `out of memory` at the 64 MiB cap, next pattern loads and plays |
| syntax error | reported with position; the previous pattern keeps playing |

## Choices it forces on the integration

- **Query off the audio thread.** The 28 ms maximum is a GC pause, and QuickJS offers no bound on
  one. A look-ahead of one clock tick (150 ms) absorbs it; the audio callback must only ever read
  events already queued. `StrudelHost` is single-threaded, and a runtime used from a thread other
  than its creator's needs `JS_UpdateStackTop`.
- **The bundle is a build artifact, not source.** `@strudel/*` stays pinned at 1.1.x for the
  reason `packages/song-strudel/src/strudel.ts` gives; the bundle would be generated and embedded
  the way `AirWindowsList.h` is generated.
- **The pattern's last statement must be an expression.** Strudel's transpiler refuses anything
  else before QuickJS sees it, so a hostile pattern only reaches the deadline if it ends in one —
  the guards in `main.cpp` are written that way on purpose.
- **Samples are out of scope here.** The spike proves events; `samples.ts`'s name → file resolution
  and the lane routing in `patternClock.ts` still have to move, or be answered in the document the
  file service sends.
