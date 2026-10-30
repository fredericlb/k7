// autosaveBuffers.ts — what the autosaves keep outside React: the text held back, and every pane's flush.
// Apart from autosave.ts so a host that only flushes or forgets (k7's address changes) does not load the validator.
// Held text is kept under the SCOPE it was typed in: a pane closing late must not hand it to the next project.

// Text that could not be written, by `<scope>\n<path>`, held OUTSIDE React so it survives the pane unmounting.
const held = new Map<string, string>();

// The project the page shows now; "" for a host that never names one.
let scope = "";

/** Name the scope (k7: the project address) whose buffers are recalled from now on — docs/autosave.md. */
export const setBufferScope = (s: string): void => {
  scope = s;
};
/** The scope now, for a pane to capture as it mounts: it keeps under that one whenever it closes. */
export const bufferScope = (): string => scope;

const key = (path: string, at: string) => `${at}\n${path}`;

/** Keep a buffer that could not be written. */
export const keepBuffer = (path: string, text: string, at = scope): void => {
  held.set(key(path, at), text);
};
/** The unwritten buffer for a path in this scope, for an editor about to show what is on disk instead. */
export const recallBuffer = (path: string): string | null =>
  held.get(key(path, scope)) ?? null;
/** Forget it — it landed, or the user chose disk. */
export const dropBuffer = (path: string, at = scope): void => {
  held.delete(key(path, at));
};
/** Forget every held buffer — the project they belong to was left, and its paths name files in the next one too. */
export const forgetBuffers = (): void => {
  held.clear();
};
/** Forget it only if what is held is the text that just landed: anything typed since stays. */
export const settleBuffer = (
  path: string,
  landed: string,
  at = scope,
): void => {
  if (held.get(key(path, at)) === landed) held.delete(key(path, at));
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
