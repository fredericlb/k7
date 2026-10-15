// latestAnswer.ts — several reads of one thing in the air at once, answered in any order: each is
// numbered when it STARTS, and an answer older than one already shown is dropped. Without it a slow
// read begun before an open could land after it and put the previous project back in the header.

/** A setter that, asked for a slot per read, applies only answers no older than the last shown. */
export function latestAnswer<T>(set: (v: T) => void): () => (v: T) => void {
  let asked = 0;
  let shown = 0;
  return () => {
    const n = ++asked;
    return (v: T) => {
      if (n < shown) return;
      shown = n;
      set(v);
    };
  };
}
