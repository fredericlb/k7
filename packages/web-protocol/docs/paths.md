# paths.ts — the lexical half of every path confinement

Many places in this tree turn a path someone else chose — a song file's `source:`, an upload's
name, a replica's op, a share's manifest, a tunnel request — into a file on disk. Each needs the
same two questions answered: **is this absolute path inside that root**, and **is this relative
path made of plain segments**. `paths.ts` answers them once: `isWithin`, `isBelow`, `climbsOut`,
`isPlainSegment`, `plainSegments`, `assertPlainSegments`.

## Why here

The checks are needed on both sides of the wire — the file service, the hub, the tunnel and the
media library run them on node; `song-schema` (a playlist's or a reference's path) and `live-sync`
run them where a browser imports them too. So the module has no `node:` import, and it lives in the
lowest `@studio` package that is already node-free and that every consumer can depend on without a
cycle: `web-protocol` depends on `engine-protocol` alone. `song-schema` would have been the other
browser-safe candidate, but the tunnel and `live-sync` do not and should not pull the song model in.

## What it decides

- **By whole segment.** `/data/ws-old` is not inside `/data/ws`. Every hand-written
  `startsWith(root)` that forgot the separator was this bug.
- **Lexical only.** Both sides are taken as already resolved; nothing reads the disk. A symlink
  inside the root may still lead out, so a check that must hold against links is song's
  `confineTo` (`packages/song/docs/confine.md`), which runs this test on the resolved path and again
  on the real path of its nearest existing ancestor.
- **The root decides the platform.** A root spelt with a drive letter or as a UNC share is a Windows
  path: both separators count, and case is folded, as NTFS folds it. Any other root is POSIX: only
  `/` separates and a backslash is a name character, so `/data\x` is not under `/data`.
- **The root itself is inside** for `isWithin` and not for `isBelow`. A writer that must name a
  file under a folder uses `isBelow`; a reader that may list the folder uses `isWithin`.
- **`climbsOut` reads a `path.relative` answer.** It is `..` or begins with `../` or `..\`, or it is
  absolute (another drive). A name that merely begins with two dots, `..foo`, stays in.
- **A plain segment** is neither empty, `.` nor `..`. An empty one is refused because a doubled or
  leading separator is never what a well-formed relative path holds.

## What stays elsewhere

- The tunnel's `safeSegment` (`packages/engine-tunnel/segments.ts`) builds on `isPlainSegment` and
  is stricter on purpose: it refuses what Windows would open as a device or trim to a dot, since a
  segment it passes becomes a file name on the engine's machine.
- `live-sync`'s `syncPathError` keeps its own reasons — a backslash, a drive letter — since a
  refusal there is logged by name, and it builds on `isPlainSegment` for the segment rule.
