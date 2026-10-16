// pool.ts — run an async function over many items with a ceiling on how many are in flight.
// A library walk is latency, not CPU: unbounded it would hold one file handle per song at once.

/** How many directories are read, or files stat'd or read, at once by every walk in this package. */
const FANOUT = 32;

/** `fn` over every item, at most `limit` at a time, results in the items' order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit: number = FANOUT,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}
