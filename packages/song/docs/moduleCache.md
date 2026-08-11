# moduleCache.ts — why the module vocabulary is memoised, and what makes it safe

`loadModules` and `loadModuleRefs` are the expensive half of every compile, and the half that
changes least. This page says how much, what the cache is keyed on, and the two rules a caller
has to keep.

## The measurement

A real song on the dev machine — 20 tracks, 171 clips, 51 instances — with the machine's
médiathèque mounted as a shared library:

| | files read | time |
|---|---|---|
| the project's own `modules/` + `instances/` | 24 YAML | 103 ms |
| the médiathèque's `modules/` (`readModuleTree`) | 315 YAML | ~140 ms |
| the panels and MIDI maps beside them (`loadUiLibrary`, `loadControllerLibrary`) | | 55 ms |
| **`loadModuleRefs` total** | | **295 ms** |
| the stamp that replaces it | 391 `stat`, 318 `readdir` | **20 ms** |

That 295 ms was paid four to six times behind ONE command in l8: `loadProject` wants the
vocabulary, `loadGraph` wants it again, and so do `projectErrors` and `hints` — each of which
the browser fetches as soon as the command returns. Switching a track's alternative — one line
rewritten in one YAML file — cost about 2.6 s of file service, almost all of it re-reading a
médiathèque that had not changed since the app was opened.

## What the stamp covers

`moduleStamp(dir)` walks exactly the roots the two loaders read:

- the project's own `modules/`, and its flat `instances/`
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
reads") forgets that this process is itself a writer: `module param` writes a module file and
reloads the project in the same synchronous stretch, so the second read would be answered from
a stamp taken before the write. `packages/song`'s suite catches it — 13 failures in
`presets.test.ts` and its neighbours, all of the shape "module 'synth' has no params". The
walk is 20 ms; pay it per call.
