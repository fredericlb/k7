// prewarm.ts — analysing the set list BEFORE a record is put on a deck.
//
// The tempo and the beat grid come from a sidecar the engine writes on first read. On this machine
// four songs in two hundred and seventy-nine have one, so putting on anything else leaves the fader
// at `—` and SYNC dark for several seconds — the state `docs/bpm.md` describes and calls normal.
// It is normal at a desk and unusable on a stage, and the playlist a surface names says exactly
// which files matter. See docs/prewarm.md.
//
// One at a time, on purpose: the analysis is the ENGINE's, and a set list fired at it in parallel
// would compete with the record somebody is actually loading.

/** How far along the set list is — what the desk draws, and all it draws. */
export interface Prewarm {
  done: number;
  failed: number;
  total: number;
}

export const NO_PREWARM: Prewarm = { done: 0, failed: 0, total: 0 };

/** Is there anything worth saying about this? A finished or empty run says nothing. */
export const prewarming = (p: Prewarm): boolean =>
  p.total > 0 && p.done + p.failed < p.total;

/** Walk the set list, analysing one song at a time.
 *
 * `analyse` is the SAME call a load makes, so a song warmed here costs a load nothing and a song
 * loaded first costs this nothing: the route is a cache either way. Nothing is skipped here for
 * that reason — asking is how you find out, and asking is cheap once it is warm.
 *
 * A failure is COUNTED and never thrown: one unreadable file must not stop the twenty-nine after
 * it, and the desk has somewhere to say so. */
export async function prewarmSet(
  paths: readonly string[],
  analyse: (path: string) => Promise<unknown>,
  /** Still wanted? Checked between songs, so a closed desk or a new playlist stops the walk. */
  alive: () => boolean,
  onProgress: (p: Prewarm) => void,
): Promise<Prewarm> {
  let at: Prewarm = { done: 0, failed: 0, total: paths.length };
  if (!paths.length) return at;
  onProgress(at);
  for (const path of paths) {
    if (!alive()) return at;
    try {
      await analyse(path);
      at = { ...at, done: at.done + 1 };
    } catch {
      at = { ...at, failed: at.failed + 1 };
    }
    if (!alive()) return at;
    onProgress(at);
  }
  return at;
}
