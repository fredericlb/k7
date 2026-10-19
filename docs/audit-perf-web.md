# Audit — speed on the web side

The counterpart to [engine/k7-runtime/docs/audit-stabilite.md](../engine/k7-runtime/docs/audit-stabilite.md)
for everything that is not C++: the file service, the compiler, the surfaces — plus the WIRE, where
the two meet. What belongs to C++ alone (the audio callback, `applyFull`, the compile flags) stays
there.

It takes that page's method rule, the only one that matters here:

> **Measuring across two builds is not measuring.**

A number taken before an `npm i`, a restart or a change of machine does not compare with one taken
after. What compares is two arms of the same invocation.

## What to measure with

Three benches, `npm run bench` in each of three packages:

| target | package | what it isolates |
|---|---|---|
| `compileNodeProject` | `song` | the compiler, disk included |
| `buildGraphDoc` | `file-service` | the chains view, **without** clip extents — those are the compiler, and two costs folded into one mean nothing |
| `buildGraph` | `ui-chains` | node/edge arithmetic + dagre, **no disk**: this function takes a `WebGraph`, not a folder |

The fixture is **synthetic and parameterised by size** (`packages/song/src/benchProject.ts`,
published through the existing `./testSupport` door rather than one more subpath — see
`docs/inventaire.md` on subpaths nobody imports). The projects committed under `demos/` hold ONE
track: a one-track fixture would measure startup and nothing else. Two sizes, 8 and 64 tracks,
because what is read is the **curve** — a cost that doubles when the song doubles is fine, a cost
that quadruples is the finding.

The folder ends in `.k7`, and that is not cosmetic: the service decides a folder is a project by
its NAME. A bare temporary folder compiles perfectly through `@studio/song` and stays invisible to
`Workspace` — both halves of the harness have to be able to open it.

## What the numbers say

| | 8 tracks | 64 tracks | ratio |
|---|---|---|---|
| `buildGraph` (no disk) | 0.046 ms | 0.365 ms | **×8** |
| `compileNodeProject` | 13.4 ms | 68.1 ms | ×5 |
| `buildGraphDoc` | 13.5 ms | 68.5 ms | ×5 |

Three things fall out, none of them visible from reading the code:

- **`buildGraph` is exactly linear.** Eight times the tracks, eight times the time. dagre and the
  graph arithmetic are not a problem and need no attention.
- **The other two cost the same to the millisecond.** `buildGraphDoc` does not compile the project
  here — and it still costs what the compiler costs. Both are therefore dominated by a third cost
  they share: reading the modules off disk.
- **The large size has ±36 to 40 % variance** (min 17 ms, max 92 ms on the same measurement), where
  the small one has ±1.5 %. That is a cache sometimes hitting and sometimes missing, and it is the
  module stamp walk — below.

## What each route costs

Measured on the real workstation, on `lemo_mante/01.danse.k7` — a 15-track song in a repository of
721 directories — eight passes per point, in milliseconds:

| | ms | |
|---|---|---|
| `GET /workspace` | 0.01 | the list is held; 25.8 on the rescan, once every 5 s |
| `GET /project-errors` | 29.2 | one stamp walk, taken in scope |
| `GET /project-doc` | 4.9 | memoised; this is the token walk |
| `GET /graph` | 4.8 | same, 62 ms cold |
| `GET /module-libraries` | 14.4 | no cache — below |
| the walks of a command that WRITES | 16 | one traversal per phase (`walkProject` / `withWalk`) |
| the six routes of a reload | 108 | 230 without the module-folder watcher |

The service is **one process**: all of that queues.

`/workspace`'s trade-off is written down and tested: a folder appearing behind the service's back (a
hand `mkdir`) shows on the next scan and not the next poll. `cachedProjectDoc` refuses
that bargain, and must — a stale COMPILE is confidently wrong about a song. A project list five
seconds behind is a picker that has not yet seen a folder: a wait, not a lie.

The scan descends INTO a project — a project can nest another — so stopping at the first one
recognised would be a rule this repository has never had. A test pins it, with the deep project
(`albums/winter.k7`).

## The module stamp — the top cost

It is the top cost in this whole neighbourhood: **19 ms** per walk, and it is those 19 ms, not
`loadModules`'s deep clone (0.21 ms over 575 refs), that make the variance of large projects. It is
worth what it protects — a 295 ms read — so the remedy is not to remove it but to pay it less often.

### It cannot make fewer syscalls, so it makes them in parallel

Measured on the reference song: **329 `readdir` = 11.7 ms, 419 `stat` = 11.9 ms**, half and half,
when they are issued one at a time. `packages/song/src/stampWalk.ts` issues them all at once on a
worker thread the caller blocks on: **44 ms → 12 ms** over `k7-core/` on Windows. Why a worker and
not `async`, and what it costs an idle account: `packages/song/docs/moduleCache.md`. None of the
bullets below changes with it — they are why the COUNT of syscalls stays where it is.

- `readdirSync(recursive: true)` gains nothing (23.6 ms against 23.5): it stats internally to decide
  whether to descend. Dead end.
- The 419 `stat`s are on files whose content is REALLY read: 291 `module.k7x`, 42 `ui.k7x`, 68
  files under `nodes/`. That leaves a dozen or so `jsdsp.ts` and `.vstpreset` of which only the PATH
  is kept — 4 % of the total. Shrinking `DEFINITION` is not worth its risk.
- A DIRECTORY's mtime does not move when a file's content changes (NTFS), so it cannot replace the
  file `stat`s. That is what closes the door.
- A clock-based cache is refused by `moduleCache.ts` itself, and rightly: the repository writes
  module files in its tests and reads them straight back.

### It is paid once per derivation, not once per read

`withModuleStamp` and `withRevision` are **re-entrant** scopes: a scope nested on the same project
finds the open one (`if (scope?.dir === dir) return fn()`) instead of opening a new one and throwing
away the stamp already paid. A test pins the contract, and it is demanding both ways: inside a
scope, module folders are held to be still, and the nested call must honour the SAME promise rather
than quietly re-checking.

The revision token looks at two files OUTSIDE the project, because two files outside the project
decide those answers: the engine's scan cache (`<state>/exts.json`, source of the `@engine/…`
modules) and the machine's preferences (`<state>/preferences.yaml`, source of a channel's label).
Two more `stat`s on a walk that does hundreds, and it is in the TOKEN rather than in each cache,
because it is a property of "what has changed", not of one of the readers.

### And under one walk per route, thanks to the watcher

A scope goes no further than one derivation, and six routes are six requests: getting under six
walks per reload means holding the stamp BETWEEN requests. `@studio/song` has a one-line seam for
that — `useFoldersStill(fn)`, a boolean — and nothing else: no watcher, no clock, no dependency.
`false` means "walk", and that is what everything installing nothing gets: the tests, a script. The
watcher is in the file service, the only process living long enough to hold handles, with a
ten-second ceiling because `fs.watch` loses events — without a ceiling, one lost event would leave
the vocabulary stale FOR GOOD. Full rationale: `packages/file-service/docs/moduleWatch.md`.

**A watcher is not enough: the writing process must SAY so too.** `fs.watch` delivers its events on
the next tick, so a command that writes a module file and then rebuilds the graph — one request,
synchronous — asks before its own event arrives, and the ten-second ceiling does not help: those ten
seconds are exactly the ones that count. Hence `moduleFoldersMoved()`, wired to
`Workspace.invalidateProjectDoc`, the single crossing point of "something changed". Deliberately
blunt, every write and not only a module's: knowing which ones is already knowing the answer, and
one more walk after a write is exactly what a write cost anyway. The lesson holds for any
watcher-backed cache: both sources must be wired, not one or the other.

## Left as it is, knowingly

- **`/module-libraries` gains nothing from caching.** Its only honest token is the module stamp,
  which walks the same trees and costs 19 ms where the route costs 14: the cache would cost more
  than it saves. And the depth cannot be reduced — the Libraries tab passes the subtrees as they are
  to `foldModules`, which needs a module folder's content to make a row of it.
- **`setCachedProjectDoc` calls `revision()` in the MIDDLE of the mutation**, so outside any scope,
  so one more walk for every command going through `applyProject` (mute, solo, a fader). It cannot
  be shared: it describes an instant that is neither the before nor the after. Removing it would
  mean the compiled doc gives itself a token it did not measure, which is exactly the lie
  `cachedProjectDoc` refuses.

## Already good, and not to be re-suspected

- **The `/revision` poll is single and refcounted** (`useRevision.ts`), in-flight requests dropped.
  There is **no** second timer on that route. The other timers target other routes and are all
  conditional.
- **`loadModules`'s clone costs 0.21 ms**, not 19 (above).
- **The five large React components follow the leaf rule** of
  [timeline.md](../apps/k7/frontend/docs/timeline.md): each 20 Hz reader is its own component, and
  `Grid`, `RulerTicks`, `ClipContent`, `Node`, `Widget` are memoised on primitive props. The rule
  has a limit: "a leaf" is the right remedy when something is DRAWN, not when a value is merely
  handed to imperative code — there, the right number of components is zero, and the reader
  subscribes to the store directly.
- **`buildGraph` is linear** (above). Do not touch it for speed.

## How to verify a change here

1. `npm run bench` in the package concerned, before and after, **on the same machine and with no
   reinstall in between**.
2. For a cost that does not read on a stopwatch — a directory walk, an allocation, a frame sent —
   count the call rather than time it: a temporary counter INSIDE the measured module, a raw socket
   counting frames, `getWatched()` returning what chokidar holds. An integer does not fluctuate.
   What does NOT work: replacing `fs.readdirSync` from a script, because named imports of a `node:`
   module are frozen at binding — the counter stays at zero without a word.
3. `npm run test` stays the net — it runs every workspace regardless of an earlier one failing,
   by default: an optimisation that changes an answer is a regression, not an optimisation.
4. For C++, additionally: `cmake --build --preset windows-msvc`, the **four** named test targets then
   `ctest -R studio_`, and a `--list-audio-devices`. Dev-workstation trap: the dev session rebuilds
   on its own, but `Copy-Item` PRESERVES the source file's date — a `main.cpp` restored from a copy
   looks older than its `.obj` and MSBuild does not recompile it. The binary tested is then the old
   one, and everything looks fine.
