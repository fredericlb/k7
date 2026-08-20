# moduleCache.ts — why the module vocabulary is memoised, and what makes it safe

`loadModules` and `loadModuleRefs` are the expensive half of every compile, and the half that
changes least. This page says how much, what the cache is keyed on, and the two rules a caller
has to keep.

## The measurement

A real song on the dev machine — 20 tracks, 171 clips, 51 nodes — with the machine's
médiathèque mounted as a shared library:

| | files read | time |
|---|---|---|
| the project's own `modules/` + `nodes/` | 24 YAML | 103 ms |
| the médiathèque's `modules/` (`readModuleTree`) | 315 YAML | ~140 ms |
| the panels and MIDI maps beside them (`loadUiLibrary`, `loadControllerLibrary`) | | 55 ms |
| **`loadModuleRefs` total** | | **295 ms** |
| the stamp that replaces it | 391 `stat`, 318 `readdir` | **20 ms** |

That 295 ms was paid four to six times behind ONE command in st0: `loadProject` wants the
vocabulary, `loadGraph` wants it again, and so do `projectErrors` and `hints` — each of which
the browser fetches as soon as the command returns. Switching a track's alternative — one line
rewritten in one YAML file — cost about 2.6 s of file service, almost all of it re-reading a
médiathèque that had not changed since the app was opened.

## What the stamp covers

`moduleStamp(dir)` walks exactly the roots the two loaders read:

- the project's own `modules/`, and its flat `nodes/`
- every shared library `modulePanelRoots` finds — the workspace's `_modules`, the médiathèque
- `~/.studio/exts.json`, the engine's plugin scan, which is a module source with no folder

For each entry it mixes the NAME into an FNV-1a hash, counts it, and — for the files whose
content decides what a module is (`.yaml`, `.yml`, `.ts`, `.vstpreset`) — takes the newest
mtime. Names rather than a plain count because a rename keeps both the count and the mtime,
and a stamp that missed one would serve a module under a name nobody wrote.

The exposure left is the one the rest of this codebase already lives with, and states in the
same words: a write that changed a file's content while keeping its size and its
sub-millisecond mtime. `Workspace.revision()` keys the compiled project on the same kind of
token, and `waveformCache`'s envelope memo on an mtime alone.

## The two rules

**A cached read never leaves the loader.** `cloneModules` hands back a fresh map of fresh
module objects. Both rules it protects are real and were found by reading the callers:

- `ioPorts` ADDS to the map it is given — it files the project's own io modules in beside the
  refs. A shared map would have grown a copy of them on every call.
- `applyUiLibrary` writes `ui` and `cc` onto the modules in place, and `loadModules` and
  `loadModuleRefs` do it by two DIFFERENT rules (a module's own refs, versus the ref it is
  filed under). Sharing the objects would let whichever ran last decide what the other's caller
  saw.

Aliases survive the clone: a module filed under both `audio/reverb` and `@project/audio/reverb`
stays one object, which is what `loadModuleRefs` has always keyed those two as.

**An injected catalogue is never cached.** `loadModuleRefs(dir, {})` is a test naming its own
vocabulary, and the catalogue is the one input the stamp cannot see.

## What was tried and does not work

Walking the stamp **once per turn of the event loop** — memoise it, clear it on `setImmediate`
— looks safe and is not. The reasoning behind it ("nothing can land between two synchronous
reads") forgets that this process is itself a writer: `node param` writes a module file and
reloads the project in the same synchronous stretch, so the second read would be answered from
a stamp taken before the write. `packages/song`'s suite catches it — 13 failures in
`presets.test.ts` and its neighbours, all of the shape "module 'synth' has no params". The
walk is 20 ms; pay it per call.

## `withModuleStamp` — per READ SCOPE, which a tick is not

Per call is one walk too many all the same, and it shows in a profile. A compile asks the cache
twice — `loadModules`, then `loadModuleRefs` a few lines later — and stamped twice. On the
`01.danse.st0` song (15 tracks, 57 clips, 31 plugins, the médiathèque mounted) one walk is
328 `readdir` + 418 `stat` and **28 ms**, against a 140 ms compile: the second walk was 19% of
`compileNodeProject` and of `loadGraph` alike, spent proving nothing had changed since the
previous line.

`withModuleStamp(dir, fn)` gives `fn` one stamp, computed on the first ask inside it. What
makes it safe is exactly what the tick memo lacked: the scope is **named by a caller that reads
and never writes**. `compileNodeProject` and `loadGraph` are those callers — a compile is a pure
read of a folder — and they are the only two. Everything outside a scope stamps per call, as
before, so `node param`'s write-then-reload still sees its own write.

Lazily, too: a scope that never asks the cache walks nothing.

### One more syscall per entry, next door

`yamlFilesIn` in `yaml/moduleIO.ts` belongs to the same pass: listing a folder used to cost
three syscalls per entry — the `readdir`, a `statSync` to prove the entry was a file, then
`existsSync` back through `moduleFileFor` to find the name `readdir` had just handed over. A
`Dirent` says file-or-directory itself; only a symlink still needs the stat.

With the scope above, that took the song from 140 ms to 96 ms, and `buildGraphDoc` from 133 ms
to 102 ms. The rest of this page is what was still in those 96 ms.

## The entity files — `yaml/yamlCache.ts`

`readYamlEntities` was what remained, ~40% of a compile: 183 files read and parsed on every
command, of which one had changed.

**The audit the "two rules" section demands, for clips, sequences, curves and video tracks.**
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
silently not happening. It is the same class of mistake as the tick memo above, found the same
way: by trying to break it rather than by a green suite. `packages/song` passed with the unsafe
key.

The fix is not a finer key but a narrower one. An mtime is trusted only once it is **older than
any clock or filesystem granularity** (2 s: NTFS is sub-ms, FAT is 2 s, network mounts are 1 s),
and only a read taken while the file was already settled is stored. Nothing stops two writes
from sharing a stamp; what this stops is the cache ever *holding* an entry whose stamp a later
write could still reproduce. The file you just edited fails the test, is re-read, and is not
cached; the 182 you did not touch are served.

`yamlCache.test.ts` pins that invariant, and only that one — the "same size straight after a
read" case is a sanity check, since whether two writes share a tick is up to the clock and a
test that depends on it proves nothing. Verified red by setting `SETTLE_MS` to -1.

What is left is what this codebase already states wherever it caches on an mtime
(`waveformCache`, `Workspace.revision()`): a clock stepped backwards past the window.

### Reading is the syscall, not the byte

Worth knowing before optimising the next one. On this machine `readFileSync` costs ~0.36 ms per
file **whatever its size** — it is open/read/close, not the content: 57 clip files totalling
9 KB cost 21 ms to read and 6 ms to parse. Skipping the read is therefore the bigger half, which
is why a content-addressed cache (keep the read, compare the text, skip only the parse) was
tried and dropped: perfectly safe, and it recovered only 12 ms of the 46.

## The seam: something that already knows

The walk is 20 ms and cannot be made cheaper — measured: half `readdir`, half `stat`, and the
`stat`s are on the files whose content is genuinely read (291 `module.yaml`, 42 `ui.yaml`, the
`nodes/`). A directory's own mtime does not move when a file inside it is edited, so there is no
shortcut. What is left is asking less often, and a scope only reaches as far as one derivation.

So `useFoldersStill(fn)` lets a process that WATCHES those roots answer instead. It is a single
bit — "have they moved?" — and deliberately not a token: this file must hand back the stamp the
walk would have produced, or the memo would miss and re-read the whole médiathèque every time
the answer changed hands. The first read of a project always walks whatever the answer, which is
what makes an empty or lying watcher safe rather than merely unlikely.

Nothing here installs one. The file service does, in its `listen` callback, because holding file
handles is a property of being a long-lived server — a CLI run, a test and a script keep walking
exactly as before, and none of them pays for a watcher they would immediately close. The
implementation, the platform quirks and the ceiling that heals a missed event live over there:
`packages/file-service/docs/moduleWatch.md`.

## Where the time ends up

Same song, same machine, warm:

| | before | after |
|---|---|---|
| `compileNodeProject` | 140 ms | **53 ms** |
| `buildGraphDoc` (via `loadGraph`) | 133 ms | **57 ms** |
