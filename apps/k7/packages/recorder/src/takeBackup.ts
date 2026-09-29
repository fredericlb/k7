// takeBackup.ts — every chunk of a take written to IndexedDB as it is recorded, so a tab that crashes or is
// evicted mid-take leaves the audio behind for the next visit to hand back (docs/recordings.md).
// The one thing a reader would get wrong: it is BEST-EFFORT — a full quota or no IndexedDB means no backup, never a broken take.

const DB = "k7-takes";
const TAKES = "takes";
const CHUNKS = "chunks";

export interface BackedUpTake {
  id: string;
  startedAt: string;
  mime: string;
  bytes: number;
}

let opening: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore(TAKES, { keyPath: "id" });
        d.createObjectStore(CHUNKS, { keyPath: ["take", "seq"] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

// One transaction, its outcome as a promise that never rejects — a backup that failed is only a missing backup.
async function run(
  stores: string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => void,
): Promise<boolean> {
  const d = await db();
  if (!d) return false;
  return new Promise((resolve) => {
    try {
      const tx = d.transaction(stores, mode);
      fn(tx);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** Start backing up a take; its chunks follow through backupChunk. */
export function beginTake(id: string, mime: string): Promise<boolean> {
  return run([TAKES], "readwrite", (tx) =>
    tx
      .objectStore(TAKES)
      .put({ id, startedAt: new Date().toISOString(), mime, bytes: 0 }),
  );
}

/** One chunk, in order. */
export function backupChunk(
  id: string,
  seq: number,
  data: Blob,
): Promise<boolean> {
  return run([CHUNKS], "readwrite", (tx) =>
    tx.objectStore(CHUNKS).put({ take: id, seq, data }),
  );
}

/** The take is saved elsewhere, or deliberately thrown away: its backup goes. */
export function forgetTake(id: string): Promise<boolean> {
  return run([TAKES, CHUNKS], "readwrite", (tx) => {
    tx.objectStore(TAKES).delete(id);
    tx.objectStore(CHUNKS).delete(
      IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]),
    );
  });
}

/** Every take a previous visit left behind, with how much audio each holds. */
export async function listBackedUpTakes(): Promise<BackedUpTake[]> {
  const takes: BackedUpTake[] = [];
  const sizes = new Map<string, number>();
  await run([TAKES, CHUNKS], "readonly", (tx) => {
    tx.objectStore(TAKES).openCursor().onsuccess = (e) => {
      const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!c) return;
      takes.push(c.value as BackedUpTake);
      c.continue();
    };
    tx.objectStore(CHUNKS).openCursor().onsuccess = (e) => {
      const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!c) return;
      const { take, data } = c.value as { take: string; data: Blob };
      sizes.set(take, (sizes.get(take) ?? 0) + data.size);
      c.continue();
    };
  });
  return takes
    .map((t) => ({ ...t, bytes: sizes.get(t.id) ?? 0 }))
    .filter((t) => t.bytes > 0)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** A left-behind take as one file, its chunks in recorded order. */
export async function readBackedUpTake(take: BackedUpTake): Promise<Blob> {
  const parts: Blob[] = [];
  await run([CHUNKS], "readonly", (tx) => {
    const range = IDBKeyRange.bound(
      [take.id, 0],
      [take.id, Number.MAX_SAFE_INTEGER],
    );
    tx.objectStore(CHUNKS).openCursor(range).onsuccess = (e) => {
      const c = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!c) return;
      parts.push((c.value as { data: Blob }).data);
      c.continue();
    };
  });
  return new Blob(parts, { type: take.mime });
}
