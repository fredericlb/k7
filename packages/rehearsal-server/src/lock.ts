// lock.ts — work on the same key run one at a time, in arrival order: a read-modify-write on the store spans awaits
// (an upload, a fetch), so two appends to one session, or two sheet uploads to one song, would each overwrite the other.
// The one thing a reader would get wrong: it is per PROCESS — right for this backend, which runs as one (../docs/audit.md).

const tails = new Map<string, Promise<unknown>>();

/** Run `fn` once every earlier call on `key` has settled; a failure frees the key for the next caller all the same. */
export function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(fn);
  tails.set(key, next);
  // Forgotten once nobody queued behind it, so the map holds only keys in use.
  next
    .catch(() => {})
    .finally(() => {
      if (tails.get(key) === next) tails.delete(key);
    });
  return next;
}
