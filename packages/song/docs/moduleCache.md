# moduleCache.ts — why the module vocabulary is memoised, and what makes it safe

`loadModules` and `loadModuleRefs` are the expensive half of every compile, and the half that
changes least. This page says how much, what the cache is keyed on, and the two rules a caller
has to keep.

## The measurement

A real song on the dev machine — 20 tracks, 171 clips, 51 nodes — with the machine's
médiathèque mounted as a shared library:

| | files read | time |
|---|---|---|
| the project's own `modules/` + `nodes/` | 24 files | 103 ms |
| the médiathèque's `modules/` (`readModuleTree`) | 315 files | ~140 ms |
| the panels and MIDI maps beside them (`loadUiLibrary`, `loadControllerLibrary`) | | 55 ms |
| **`loadModuleRefs` total** | | **295 ms** |
| the stamp that replaces it | 391 `stat`, 318 `readdir` | **20 ms** |

That 295 ms is paid four to six times behind ONE command in k7: `loadProject` wants the
vocabulary, `loadGraph` wants it again, and so do `projectErrors` and `hints` — each of which
the browser fetches as soon as the command returns. Uncached, switching a track's alternative —
one line rewritten in one file — costs about 2.6 s of file service, almost all of it
re-reading a médiathèque that has not changed since the app was opened.

## What the stamp covers

`moduleStamp(dir)` walks exactly the roots the two loaders read:

- the project's own `modules/`, and its flat `nodes/`
- every shared library `modulePanelRoots` finds — the workspace's `_modules`, the médiathèque
- `<state>/exts.json`, the engine's plugin scan, which is a module source with no folder

For each entry it mixes the NAME into an FNV-1a hash, counts it, and — for the files whose
content decides what a module is (`.k7x`, `.ts`, `.js`, `.vstpreset`) — takes the newest
mtime. Names rather than a plain count because a rename keeps both the count and the mtime,
and a stamp that missed one would serve a module under a name nobody wrote.

The exposure left is the one the rest of this codebase already lives with, and states in the
same words: a write that changed a file's content while keeping its size and its
sub-millisecond mtime. `Workspace.revision()` keys the compiled project on the same kind of
token, and `waveformCache`'s envelope memo on an mtime alone.

## The two rules

**A cached read never leaves the loader.** `cloneModules` hands back a fresh map of fresh
module objects. Both rules it protects are real, and both are properties of the callers:

- `ioPorts` ADDS to the map it is given — it files the project's own io modules in beside the
  refs. A shared map would grow a copy of them on every call.
- `applyUiLibrary` writes `ui` and `cc` onto the modules in place, and `loadModules` and
  `loadModuleRefs` do it by two DIFFERENT rules (a module's own refs, versus the ref it is
  filed under). Sharing the objects would let whichever ran last decide what the other's caller
  sees.

`cloneModules` still has to hold this rule generally, whether or not any one read happens to alias
a module under two keys: a fresh map of fresh objects is the property `ioPorts` and
`applyUiLibrary` rely on, not a fact about how many keys a module answers to today.

**An injected catalogue is never cached.** `loadModuleRefs(dir, {})` is a test naming its own
vocabulary, and the catalogue is the one input the stamp cannot see.

## The variant that does not work

Walking the stamp **once per turn of the event loop** — memoise it, clear it on `setImmediate`
— looks safe and is not. The reasoning behind it ("nothing can land between two synchronous
reads") forgets that this process is itself a writer: `node param` writes a module file and
reloads the project in the same synchronous stretch, so the second read would be answered from
a stamp taken before the write. `packages/song`'s suite catches it — 13 failures in
`presets.test.ts` and its neighbours, all of the shape "module 'synth' has no params". The
walk is 20 ms; pay it per call.

## `withModuleStamp` — per READ SCOPE, which a tick is not

Per call is one walk too many all the same, and it shows in a profile. A compile asks the cache
twice — `loadModules`, then `loadModuleRefs` a few lines later — and stamping per call stamps
twice. On the `01.danse.k7` song (15 tracks, 57 clips, 31 plugins, the médiathèque mounted) one
walk is 328 `readdir` + 418 `stat` and **28 ms**, against a 140 ms compile: the second walk is
19% of `compileNodeProject` and of `loadGraph` alike, spent proving nothing has changed since the
previous line.

`withModuleStamp(dir, fn)` gives `fn` one stamp, computed on the first ask inside it. What
makes it safe is exactly what the tick memo lacked: the scope is **named by a caller that reads
and never writes**. `compileNodeProject` and `loadGraph` are those callers — a compile is a pure
read of a folder — and they are the only two. Everything outside a scope stamps per call, so
`node param`'s write-then-reload still sees its own write.

Lazily, too: a scope that never asks the cache walks nothing.

**It is RE-ENTRANT, and that is not a nicety.** A scope already open for the same project is kept
rather than replaced. Opening a fresh one would throw the enclosing scope's stamp away and walk
again — which is how HOISTING a scope over two calls that each open their own (a compile and a
graph build) makes things *slower*, by +19 ms a level. Same shape as `withRevision` in the file service,
and for the same reason. The previous scope is RESTORED rather than cleared on the way out, because
a scope for another folder may enclose this one — the graph of a library chain built while a project
is open — and the two stamps are not the same.

The oracle above is asked only when there IS a previous stamp to hand back, which is what makes an
empty watcher safe. `cachedForModules`'s `key` names WHICH read (the loaders cache two), so one
stamp walk covers both, and insertion order is the LRU: a slot is re-inserted on every hit and the
oldest goes when there are too many.

### One more syscall per entry, next door

`yamlFilesIn` in `yaml/moduleIO.ts` belongs to the same pass: listing a folder costs one syscall
per entry and not three. A `Dirent` says file-or-directory itself, so neither a `statSync` to
prove the entry is a file nor an `existsSync` back through `moduleFileFor` for the name `readdir`
has just handed over is needed; only a symlink needs the stat.

With the scope above, that puts the song at 96 ms rather than 140, and `buildGraphDoc` at 102 ms
rather than 133. The rest of this page is what is left in those 96 ms.

## The entity files — `yaml/yamlCache.ts`

`readYamlEntities` is what remains, ~40% of a compile: 183 files read and parsed on every
command, of which one has changed.

**The audit the "two rules" section demands, for clips, sequences and curves.**
What is cached is the RAW parse; the entity schema then runs on every call, and zod **rebuilds
the whole structure** — measured, down to the tuples inside `warp.markers`: no nested object,
array or tuple in `r.data` is ever the raw's. So the caller's result is fresh by construction
and the cached parse never leaves the module. That only holds where there IS a schema, so the
cache is used only there — `tracks` is the one schema-free kind, and no compile path reads it.

Validation is not the cost, either: over the real `clips/` and `sequences/`, reading and parsing
is 84 ms and `safeParse` is **1.1 ms**. Re-validating per call buys the safety for 1%.

### The key is an mtime that has SETTLED, and that is the whole of it

Keying on `(mtime, size)` is the obvious move and is **wrong on its own**. File-time granularity
is coarse, so a rewrite landing in the same tick as the read before it keeps the same stamp.
Measured here — 3000 same-size rewrites, as fast as Node can issue them:

| | |
|---|---|
| file-time granularity on this machine | 0.52 ms |
| consecutive rewrites sharing an `(mtime, size)` | **76%** |

A cache keyed on that serves the previous content — for a clip file, the edit you just made
silently not happening. It is the same class of mistake as the tick memo above, and it is found
the same way, by trying to break it rather than by a green suite: `packages/song` passes with the
unsafe key.

The fix is not a finer key but a narrower one. An mtime is trusted only once it is **older than
any clock or filesystem granularity** (2 s: NTFS is sub-ms, FAT is 2 s, network mounts are 1 s),
and only a read taken while the file was already settled is stored. Nothing stops two writes
from sharing a stamp; what this stops is the cache ever *holding* an entry whose stamp a later
write could still reproduce. The file you just edited fails the test, is re-read, and is not
cached; the 182 you did not touch are served.

`yamlCache.test.ts` pins that invariant, and only that one — the "same size straight after a
read" case is a sanity check, since whether two writes share a tick is up to the clock and a
test that depends on it proves nothing. It goes red with `SETTLE_MS` at -1.

What is left is what this codebase already states wherever it caches on an mtime
(`waveformCache`, `Workspace.revision()`): a clock stepped backwards past the window.

### …and the same rule holds the STAMP, and the file service's text image

The module stamp is an mtime too — the newest among the files that define a module — so it has the
identical hazard, one level up: a module written in the same tick as the walk before it leaves the
stamp untouched, and the whole vocabulary is then served from before that write. Measured the way
the section above was, over the sequence the module builder actually runs (read the module map to
find the file, write it, read it back): **18 of 30** reads came back pre-write.

So `cachedForModules` applies the rule the parse cache does: a stamp whose newest mtime has not
settled is not stored, and nothing already held under it is served. What it costs is the walk plus
the reads for two seconds after an edit — and only the file that changed is re-parsed, since the
layer below is still keyed per file. What it would have cost otherwise is the edit you just made
not existing.

That layer below is `settledParse`, and the vocabulary's three readers sit on it: `readModuleFile`
(every `module.k7x` and node file), `loadUiLibrary` (every `ui.k7x`) and the `widgets.js` beside
a panel. Without it, those two seconds re-read every library the project can see, and they are
exactly the two seconds a command and the browser's follow-up fetches land in. On `01.danse.k7`
— 15 tracks, 53 plugins, three module libraries — one node edit had the next compile read 740
files (1,107 reads, `ui.k7x` twice) in 910 ms, and the graph build the same again in 873 ms;
through the per-file layer each reads only the edited file and costs ~330 ms, the rest being the
`stat`s that prove the other 739 settled. A kit preset pays both, so that is most of its server
time.

A file reaches those readers as DATA: on a miss, `settledParse` hands `k7xData` (the file parsed by
`@studio/k7x`, its short forms expanded) to the reader's data half — `parseModuleData`,
`parseUiData`, or the data itself. A module or panel that does not validate goes through the text
parser after all, since its issues are located on that text's lines.

A parse held there is shared by every later read of the file, so the readers hand out a
`structuredClone` of it: `applyUiLibrary` writes `ui` and `cc` onto the modules it gets, which is
the first of the two rules above. A script is a string, and goes out as it is.

Inside a `withModuleStamp` scope those young reads are held **for the scope**: values built under
one stamp are consistent with each other, and the danger is only in letting them outlive the
derivation that asked. That is what keeps a compile from reading the médiathèque three times in the
two seconds after a save.

`Workspace.textOf` (`packages/file-service`) keys its per-file text image on `(size, mtime)` and
therefore follows the same rule — which matters more there than anywhere: that image is what an
undo entry is diffed against, so a same-size rewrite inside one tick (`v1` → `v2`, a knob from
`0.5` to `0.7`) was journalling nothing at all. `SETTLE_MS` is exported from `moduleCache.ts` and
imported by both, because three windows that could drift is three chances to be wrong.

### What only NAMES decide is kept through the window

Those two seconds are exactly when an edit's follow-up reads land, and there are many: one
`node alternative copy` is one compile inside the command, then `/project-errors`, `/hints`,
`/module-catalogue` and `/base-modules` from the browser — each its own request, so its own
uncached vocabulary. Inside each, most of the cost was not content but the walk that finds the
panels and the MIDI maps: per module folder of every library, two `existsSync` misses for
`ui.k7x`/`.yml`, an `engines/` probe and a `stat` per entry — four walks per vocabulary (panels
and maps, for `loadModules` and for `loadModuleRefs`).

Which folders hold a `ui.k7x` or a `controller.k7x` is a fact about NAMES, and the stamp already
hashes every entry name. `cachedForModuleNames` keys on the stamp minus its mtime and has no
window, because a same-tick write can reproduce an mtime but not a name it adds or removes. The
CONTENT those files hold still goes through `settledParse`. The walk skips dot folders because the
stamp does — a folder the stamp cannot see must not be one the index depends on.

And a `build()` handed to `cachedForModules` outside a scope runs inside one holding the stamp it
was just asked under, so the reads nested in it do not walk again. That is safe for the reason a
scope is: both builds, `readModules` and `readModuleRefs`, only read.

On `01.danse.k7`, inside the window: `loadModuleRefs` 180 → 112 ms, `loadModules` 100 → 38 ms,
a compile 310 → 170 ms, a graph build 275 → 150 ms. Settled, nothing changes (~27 ms each).

### Reading is the syscall, not the byte

Worth knowing before optimising the next one. On this machine `readFileSync` costs ~0.36 ms per
file **whatever its size** — it is open/read/close, not the content: 57 clip files totalling
9 KB cost 21 ms to read and 6 ms to parse. Skipping the read is therefore the bigger half, which
is why a content-addressed cache (keep the read, compare the text, skip only the parse) is not
the answer: perfectly safe, and it recovers only 12 ms of the 46.

## Across a restart — `yaml/parseStore.ts`

The memo above dies with the process, and on a phone the process dies often: every app launch, every
stop for idleness. Parsing the module vocabulary again is ~1.5 s on a PC, several times that on a
phone, and ~3.4x more again without a JIT — iOS. So in a packaged app (`STUDIO_PARSE_CACHE=1`, set by
`apps/k7/backend/standalone.json`) a parse is also kept ON DISK, in two layers:

- **The account's** — `<account home>/.parse-cache.json`, written a little after each new parse,
  beside the workspace and never in it (it is this machine's; the sync must not carry it). It carries
  the running bundle's stamp and is dropped whole by any other bundle: a parse is only as good as the
  parser that made it. A source run — a developer editing a parser — never uses it.
- **The bundle's** — `parse-cache.json` beside `bin/`, made at bundle time by
  `scripts/parseCacheSeed.ts`, bundled with the same parsers, over the `k7-core` the bundle carries. It
  is what a FIRST launch after an install or an update finds, when the account's store is gone.

Both are keyed by CONTENT, not by path and mtime: the parser, whether the file is k7x, the short
form its path writes (`sugarKind`, all the path `sugarFor` reads), and the file's bytes. A library
copied from the bundle, or rewritten by the sync with the same bytes, is a hit; a file whose bytes
changed is not. Measured on a phone, `01.danse` opened from a cold file service: 9.3 s with nothing
stored, 3.7 s with the account's store, 3.8 s on a first launch with only the bundle's.

The account's store is ONE file of up to 6000 parsed trees, and each write serializes it whole,
synchronously. So it is written seldom: once parsing has been quiet for 2 s (a compile's hundreds of
new parses are one write), at most 30 s after the oldest unwritten parse while parses keep coming,
and once more as the process exits. And a file still SETTLING is never stored: while someone types,
each keystroke's version would be a new key, evicting the vocabulary the store is for and earning
a write each time.

## The walk runs on a worker, in parallel

The walk is half `readdir`, half `stat`, and the `stat`s are on the files whose content is
genuinely read (291 `module.k7x`, 42 `ui.k7x`, the `nodes/`). A directory's own mtime does not
move when a file inside it is edited, so no syscall can be skipped. What can be avoided is issuing
them ONE AT A TIME: every caller of the stamp is synchronous, down to the compile, and a walk on
the caller's thread makes each `readdirSync` and `statSync` wait for the last.

`stampWalk.ts` runs the same walk on a worker thread with every `readdir` and `stat` of a level
in flight at once, while the caller blocks on `Atomics.wait`. Measured on Windows over `k7-core/`
(414 `readdir`, 1,344 `stat`): **44 ms inline, 12 ms on the worker**, the round trip itself
0.05 ms. libuv's default pool of 4 is the fastest; 16 threads measured slower.

- **Why a worker and not `async`**: making the stamp async means making every derivation above it
  async — the compile, the graph, the hints, the edits in `song-edit`. Blocking on a worker keeps
  every signature as it is.
- **Why its source is a string** (`eval: true`): it uses node built-ins only, so neither the
  desktop's nor the phone's bundle has to ship a worker file for it, as `packages/audio-analysis/src/pool.ts` must.
- **It never changes a stamp.** The worker collects the names per directory and mixes them in the
  order the inline walk visits them, so both answer the same hash. `stampWalk.test.ts` holds it.
- **It costs ~15 MB and ~40 ms to start**, and the file service runs one process per account. So
  it starts on the first walk, which runs inline meanwhile, and stops after a minute without one:
  an idle account holds no isolate, and no walk is ever slower than inline.
- **A worker that fails to start, errors, or misses a 5 s deadline** leaves every later walk
  inline. The stamp is a correctness key: a slow answer is acceptable, no answer is not.

## The seam: something that already knows

Even in parallel, the walk is paid per derivation, and a scope only reaches as far as one.
What is left is asking less often.

So `useFoldersStill(fn)` lets a process that WATCHES those roots answer instead. It is a single
bit — "have they moved?" — and deliberately not a token: this file must hand back the stamp the
walk would have produced, or the memo would miss and re-read the whole médiathèque every time
the answer changed hands. The first read of a project always walks whatever the answer, which is
what makes an empty or lying watcher safe rather than merely unlikely.

Nothing here installs one. The file service does, in its `listen` callback, because holding file
handles is a property of being a long-lived server — a CLI run, a test and a script walk instead,
and none of them pays for a watcher they would immediately close. The
implementation, the platform quirks and the ceiling that heals a missed event live over there:
`packages/file-service/docs/moduleWatch.md`.

### What this package writes, it forgets

A watcher only answers for the folders it could watch, and it hears a write a tick late or not
at all: a project folder that did not exist when it was read — an engine poll on a project about
to be made, or one just deleted under the same name — has no handle on `nodes/`, and a scaffold
writes and then reads that folder inside one synchronous call. Trusting the held stamp there
hands the migration the EMPTY project it read before: no lanes, so every lane is migrated as an
anonymous node, its chain named `track` and its label a UUID. So code here that rewrites a
project folder and then reads it — `writeProjectFiles`, `migrateToChainFiles` — calls
`forgetModuleReads(dir)` after writing: the next read walks, whatever the watcher says.

## Where the time ends up

Same song, same machine:

| | uncached | warm |
|---|---|---|
| `compileNodeProject` | 140 ms | **53 ms** |
| `buildGraphDoc` (via `loadGraph`) | 133 ms | **57 ms** |
