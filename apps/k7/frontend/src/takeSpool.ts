// takeSpool.ts — where a camera take's chunks go while it records: to disk (the origin's private
// file system) as each one arrives, not into the tab's memory. An hour of 1080p is gigabytes, and
// held in memory a crash or a killed tab lost all of it; spooled, the bytes are on disk, and the
// next start offers what an interrupted take left. Memory only where OPFS is missing.
// See docs/picture.md, "Five things the recording has to get right".

/** The prefix every spooled take's file carries, which is how a leftover is recognised. */
const PREFIX = "k7-take-";

export interface Spool {
  /** Append one chunk; writes are queued, in order. */
  add: (chunk: Blob) => void;
  /** Every chunk written: the take as one Blob — file-backed when spooled to disk. */
  finish: (type: string) => Promise<Blob>;
  /** Forget it: the take was filed, or is not wanted. */
  discard: () => void;
}

const opfs = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    return (await navigator.storage?.getDirectory?.()) ?? null;
  } catch {
    return null;
  }
};

/** A spool on disk when the browser has one to give, in memory otherwise; `ext` is the take's own, kept for a recovery. */
export async function openSpool(ext: string): Promise<Spool> {
  const dir = await opfs();
  const name = `${PREFIX}${Date.now()}${ext}`;
  let writable: FileSystemWritableFileStream | null = null;
  let handle: FileSystemFileHandle | null = null;
  if (dir)
    try {
      handle = await dir.getFileHandle(name, { create: true });
      writable = await handle.createWritable();
    } catch {
      writable = null;
    }
  if (!dir || !handle || !writable) {
    // No disk to spool to: the old way, in memory, which is still a take.
    const chunks: Blob[] = [];
    return {
      add: (c) => chunks.push(c),
      finish: async (type) => new Blob(chunks, { type }),
      discard: () => {
        chunks.length = 0;
      },
    };
  }
  const file = handle;
  const out = writable;
  let queue: Promise<unknown> = Promise.resolve();
  // A chunk that could not be written is kept in memory rather than dropped: the take stays whole.
  const missed: Blob[] = [];
  return {
    add: (c) => {
      queue = queue.then(() => out.write(c)).catch(() => missed.push(c));
    },
    finish: async (type) => {
      await queue;
      await out.close().catch(() => undefined);
      const onDisk = await file.getFile();
      return new Blob([onDisk, ...missed], { type });
    },
    discard: () => {
      void dir.removeEntry(name).catch(() => undefined);
    },
  };
}

/** Untouched this long, a spool is a leftover; younger, it may be another tab's take still recording. */
const LEFTOVER_MS = 60_000;

/** What an interrupted take left on disk, oldest first, to be handed back once and removed. */
export async function recoverSpools(): Promise<{ name: string; blob: Blob }[]> {
  const dir = await opfs();
  if (!dir) return [];
  const found: { name: string; blob: Blob }[] = [];
  try {
    for await (const [name, h] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      if (!name.startsWith(PREFIX) || h.kind !== "file") continue;
      const file = await (h as FileSystemFileHandle).getFile();
      if (Date.now() - file.lastModified < LEFTOVER_MS) continue;
      if (file.size) found.push({ name, blob: file });
      else void dir.removeEntry(name).catch(() => undefined);
    }
  } catch {
    return found;
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/** Remove a recovered spool once its bytes are safe elsewhere. */
export async function dropSpool(name: string): Promise<void> {
  const dir = await opfs();
  await dir?.removeEntry(name).catch(() => undefined);
}
