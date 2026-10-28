// autosaveBuffers.ts — what the autosaves keep outside React: the text held back, and every pane's flush.
// Apart from autosave.ts so a host that only flushes or forgets (k7's address changes) does not load the validator.

// Text that could not be written, by path, held OUTSIDE React so it survives the pane unmounting.
const held = new Map<string, string>();

/** Keep a buffer that could not be written. */
export const keepBuffer = (path: string, text: string): void => {
  held.set(path, text);
};
/** The unwritten buffer for a path, for an editor about to show what is on disk instead. */
export const recallBuffer = (path: string): string | null =>
  held.get(path) ?? null;
/** Forget it — it landed, or the user chose disk. */
export const dropBuffer = (path: string): void => {
  held.delete(path);
};
/** Forget every held buffer — the project they belong to was left, and its paths name files in the next one too. */
export const forgetBuffers = (): void => {
  held.clear();
};
/** Forget it only if what is held is the text that just landed: anything typed since stays. */
export const settleBuffer = (path: string, landed: string): void => {
  if (held.get(path) === landed) held.delete(path);
};

// Every mounted autosave's "is your text on disk now?", for a host about to replace the files under it.
const flushers = new Set<() => Promise<boolean>>();

/** Register a pane's flush; the returned function unregisters it. */
export function addFlusher(f: () => Promise<boolean>): () => void {
  flushers.add(f);
  return () => {
    flushers.delete(f);
  };
}

/** Write every pane's pending text now; false when one could not (held, paused on a conflict, or a manual draft) — docs/autosave.md. */
export async function flushAutosaves(): Promise<boolean> {
  const all = await Promise.all([...flushers].map((f) => f()));
  return all.every(Boolean);
}
