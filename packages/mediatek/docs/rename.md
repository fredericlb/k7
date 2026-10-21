# The rename Windows can refuse

Every write into a library lands the same way: bytes into a temporary `<dest>.<uuid>.part`, then a
rename onto the real name. That rename is what makes a write atomic — a file under its real name
has always arrived whole (`sync.md`). On Windows it is also the one step another process can veto:

```
EPERM: operation not permitted, rename '…\original.mp3.<uuid>.part' -> '…\original.mp3'
```

`../src/place.ts` is where that refusal is answered, and every final rename in this package goes
through it: a download from another library (`../src/remote.ts`) and a write into the library
(`putFile`, `../src/write.ts`).

## Why it bites here

The library is the tree things **hold open**. On a musician's machine — the tray runs k7's
backend and its library on Windows — it is what the decks read and what the engine decodes. POSIX
lets a file somebody is reading be renamed over; Windows does not, unless whoever opened it asked
for `FILE_SHARE_DELETE`. Node asks, so a file Node is streaming does not get in the way. A C++
program opening a file the ordinary way does not, so **a master the engine has loaded cannot be
replaced while it is loaded**.

The other holder is transient and more common: a virus scanner or the search indexer opens a file
the instant it is written and lets go a few hundred milliseconds later.

## The two answers

1. **Retry**, five times over about a second. That settles the scanner.
2. **Compare, then keep.** If the name is still held and the file already there holds the same
   bytes as the one that just arrived, the rename had nothing to do: the temporary is dropped and
   the write succeeds. That is the ordinary case of copying a song from a server while it plays:
   the copy re-fetches a file that is already there, unchanged, and open in a deck.

The comparison is by **contents**, not size: two mixes of the same byte count are a coincidence,
not an impossibility, and keeping the wrong master would analyse bytes nobody asked about. Size is
checked first, so a different file usually costs no read at all. Reading a held file is allowed:
what Windows refuses is renaming or deleting it.

When the bytes differ, `FileHeldError` says what is holding the file and what to do (stop the
playback), and carries the original errno as its `cause`, which `remote.ts` flattens into the
message a browser shows. The temporary is the caller's to remove, so no caller is left guessing
whether it still exists.

## What is not a held name

`EPERM`, `EACCES` and `EBUSY` are what a held name answers with. Anything else — a missing folder, a
full disk — is thrown as it came, at once: waiting changes nothing about a full disk, and dressing
it up as a busy file sends the reader looking for a player that is not there. On POSIX the three
codes are a real permission problem, and retrying it costs a second and finds the same answer.

## The synchronous variant

`putFile` is synchronous and so are its callers, so it uses `placeFileSync`, whose waits block the
event loop. They block only while the name is held, for a second at most, and they cannot block the
holder: a reader in this process is Node, which does not hold the name.

`moveEntry` and `moveFile` rename too and do not go through this: what they move is the SOURCE, and
when the engine holds that, no file already in place can stand in for the move.
