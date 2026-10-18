# atomicWrite.ts — a file is replaced whole or not at all

A file written in place (`writeFileSync` straight onto its name) is truncated first and filled
after. A process killed between the two — a quit, a crash, a power cut — leaves a short file, and
in a workspace a short file is not a local accident: live capture reads it as an edit and sends it
to every replica. So every write that REPLACES a file the user or the sync depends on goes through
`writeFileAtomic`: the bytes go to a temp beside the file, are fsynced, and the temp is renamed
over the name. A reader sees the old bytes or the new ones.

## Decisions

- **It lives in `@studio/song`.** The workspace's own saves (`yaml/workspaceFile.ts`) are here,
  and `file-service` and `file-hub` both already sit above this package, so all three import it
  without a cycle. It has no dependency of its own.
- **The temp is hidden: `.<name>.<pid>.<8 hex>.tmp`, in the same folder.** Same folder, because a
  rename is atomic only within one file system. A leading dot, because the workspace's `skip`
  (`packages/file-service/src/workspaceFilter.ts`) hides every dot name from live capture, the
  pattern watcher and every listing: a temp is never captured, so never synced, even when a
  process dies and leaves one. A store that lists every file of its folder without that filter
  (the confirmed mirror, `liveConfirmed.ts`) asks `isAtomicTemp` instead.
- **The file keeps its mode.** An existing file's permission bits are copied onto the temp, since
  the umask would otherwise reset them on every save.
- **On Windows a refused rename is retried** a few times with a growing pause, on `EPERM`, `EBUSY`
  and `EACCES`: an antivirus or the search indexer holding the target for a moment refuses the
  rename, and a save must not fail for that. Elsewhere a refusal is real and thrown at once.
- **A failed write removes its temp and throws**, and the file is left as it was.
- **Synchronous**, like the call sites it replaces.
- **`durable: false` skips the fsync, and only the confirmed mirror asks for it.** The fsync is
  about 4 ms a file on NTFS, and a replica applying a library's first batch confirms thousands of
  files in one turn of the event loop: 2151 for `k7-core`, nine seconds of a backend that answers
  nothing. The mirror is what a restart diffs the workspace against, so a file it lost to a crash
  costs one resend of text the room already holds; a workspace file has no such second copy, and
  keeps the fsync.
- **Append-only logs stay appends.** A torn trailing line is skipped on load; only a rewrite or a
  compaction of such a log goes through here.
