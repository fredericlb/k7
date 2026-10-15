# A FLAC's derived MP3

k7's backend writes an MP3 beside every FLAC of the library, under the same name
(`original.flac` → `original.mp3`), for browsers to play (`apps/k7/backend/docs/media/derivedMp3.md`).
This package's job is to make that file **not exist** for everything that reads the library as
content.

## The rule is a name and a neighbour

An `.mp3` is derived when a `.flac` of the same stem sits in the **same folder**, compared without
case. `isDerivedMp3` and `withoutDerived` in `src/media.ts` are the whole rule, and every walk
applies `withoutDerived` to a folder's listing before looking at it:

- **the scan** (`src/scan.ts`) — so it is never a song's master, never a sample, never an unlisted
  file. A song folder takes the first audio file it sees as its master, and an `original.mp3`
  could otherwise win over `original.flac`;
- **the revision walk** (`src/revision.ts`) — so writing thousands of them moves no token, the same
  reason a `{file}.cache` is skipped ([index.md](index.md));
- **the manifest** (`src/manifest.ts`) — so a machine's mirror never fetches one: the engine plays
  the FLAC, and the mirror holds the master byte for byte ([sync.md](sync.md));
- **the capture zone's listing** (`src/recordings.ts`). Choosing a new capture's name still sees
  the MP3, so a capture never lands on one.

No sidecar, no marker file and no list of what was generated: the neighbour already says it, and
a list could disagree with the disk.

## The cost of the rule

A real MP3 uploaded beside a FLAC of the same name is hidden too, and replaced by the next
transcode once the FLAC is newer than it. So is a song variant declared as `x.mp3` beside an
`x.flac`. Keeping two recordings that differ only in extension, in one folder, is not a case the
library supports.

## It follows its FLAC

`removeFile` removes the MP3 with its FLAC, and `moveEntry` carries it along, or drops it when the
FLAC is renamed to another extension (`src/write.ts`). Otherwise a deleted FLAC would leave its MP3
behind, and with no FLAC beside it the MP3 would list as an ordinary file. A folder moved or removed
whole carries its contents anyway.

One exception: `addSong` replacing an `original.flac` with an uploaded `original.mp3` keeps that
MP3, since it is the new master, written over the derived one.
