# A bench must age its fixture

`yamlCache` deliberately refuses to cache a file whose mtime is younger than `SETTLE_MS` (2 s).
The reason is written in `yaml/yamlCache.ts`: a young mtime can still be reproduced by the next
write, so keying on it serves stale content — for a clip file, the edit you have just made,
silently undone.

A bench that writes its fixture and then measures **immediately** therefore straddles two
regimes: for the first two seconds every iteration reads, parses and throws away — the cache
*cannot* hit — and past the window it hits every time. At 64 tracks a bench runs ~1.5 s, exactly
the width of the window, so its mean mixes the two populations. They are a factor of five apart:

| | first compile | past the window |
|---|---|---|
| 8 tracks | 19.2 ms | **4.5 ms** |
| 64 tracks | 109.4 ms | **21.5 ms** |

## What `writeBenchProject` does

It stamps every file an hour into the past (`utimesSync`) right after writing it. An hour rather
than a 2 s `sleep`: what we want is not a slower bench but a fixture **in the state a real song
is in** — files written days ago, which the cache is allowed to serve. That is the regime a
musician compiles in.

The file map's keys *are* the relative paths, so the stamping walks no directory and calls no
`readdir` option whose behaviour depends on the Node version (the package declares `>=18`).

## The numbers, once the regime holds

Same machine, two benches run sequentially.

| bench | time | rme |
|---|---|---|
| `compileNodeProject` — 8 tracks | 3.68 ms | ±1.64 % |
| `compileNodeProject` — 64 tracks | 21.36 ms | ±1.74 % |
| `buildGraphDoc` — 8 tracks | 4.18 ms | |
| `buildGraphDoc` — 64 tracks | 35.65 ms | |

**The two benches do not measure the same thing.** `buildGraphDoc` costs **35.65 ms against
21.36** — the ~14 ms gap is its own work, the clip extents. In the mixed regime both are
dominated by the same uncached file reads, which return a figure identical to within 0.6 % and
hide that whole item.

**The curve is gentle.** 8× the tracks costs 5.8× (compile) and 8.5× (graphDoc).
`compileNodeProject` is sub-linear per track, so `buildGraphDoc` is the item to watch as a song
grows.

## The rule, which outlives this bench

`audit-perf-web.md` opens on "measuring across two compilations is not measuring". This is its
twin: **measuring across a cache that changes state mid-measurement is not measuring either.** A
bench must decide which regime it works in and stay there, or its standard deviation is the only
honest thing it publishes — and a bench at ±40 % cannot validate any change smaller than 40 %,
which is to say almost none: it only spots a catastrophe.

So a bench that touches the disk in this repo must age its fixture. The same holds for any
measurement made by hand: compiling a freshly written project twice in a row gives two numbers
that do not mean the same thing.

## What must NOT be cached

Zod's `safeParse` (`loader.ts`) is not cached although the k7x parse is, and it looks like the
next item along. Measured: **1.0 % of a 64-track compile**, 1 to 2.5 % at 8. And caching it would
break an invariant `loader.ts` states outright — the cached parse is safe *only because* `r.data`
is a fresh structure zod rebuilds, so nothing shared escapes the loop. Caching `r.data` would be
handing out a shared object.
