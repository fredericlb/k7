# What a node costs — CPU per plugin, memory per engine

The state frame carries a `load` object on one frame in four:

```json
"load": { "plugins": { "lane:tides": { "cpu": 0.0115 }, "deck-a": { "cpu": 0.02, "bytes": 48234496 } },
          "process": 14680064 }
```

A card shows its plugin's figure on the header's border, and k7's header shows `process` beside
the master meter (`packages/ui-chains-react/docs/nodeCard.md`). `scripts/load-probe.ts` checks the
report against a running engine.

## CPU is measured per plugin, and is audio-thread time only

`cpu` is Tracktion's own `Plugin::getCpuUsage()`: the time the plugin's block took, as a share of
the block's duration, smoothed. Tracktion measures it around every plugin's processing unless the
plugin opts out, and the three taps do (`shouldMeasureCpuUsage` false), since they are the
engine's own plumbing rather than anything a person chose. Reading it is one atomic load per
plugin, so the report costs nothing measurable.

It is audio-thread time and nothing else. A plugin that does heavy work on its own threads — a
convolution on a background thread, a model loading — reads cheaper than it is. The figure answers
"which node is eating the block", the question that decides a dropout, and not "what does this
plugin cost the machine".

## Memory is NOT per plugin, except for what our own plugins hold

Every plugin shares the engine's heap, and nothing in-process can say whose allocation is whose,
least of all an external VST3 or AU allocating through its own code. So the honest figures are two:

- **`process`** — the engine's memory as its OS counts it (`ProcessMemory.cpp`): the physical
  footprint on macOS, what Activity Monitor shows; the working set on Windows; the resident set on
  Linux and Android. One system call, on the same beat as the CPU.
- **`bytes`** — what one of OUR plugins says it holds, through `HeldMemory`: the turntable's record
  and its stretcher's buffers, the recorder's ring. A floor, its big buffers and not its footprint,
  and absent for a plugin that does not implement it — the card's tooltip says so rather than
  showing nothing, which would read as zero.

The two do not add up, and are not meant to: a mapped record's pages are the FILE's, clean and
counted in no footprint, yet they are what the deck holds.

Measuring the footprint's change around a plugin's creation was rejected: the allocator keeps what
was freed, plugins load lazily, and the number it gives would be shown as a fact.

## One frame in four, timed rather than counted

The report rides the state frame rather than a message of its own, because every surface already
watches that frame and a client needs nothing new to read it. It is sampled every 250 ms per
session, TIMED rather than counted: an idle session emits one tick in five, and a count of ticks
could never land on its emission. A frame without `load` means "unchanged"; the browser's store
keeps the last one (`packages/engine-browser/src/engineStore.ts`). Per frame it would be twenty
entries of text twenty times a second for figures nobody reads faster than a few times a second.
