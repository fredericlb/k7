// onsets.ts — the onsets a clip actually has: what the engine detected, plus the corrections made by hand.
//
// The engine's set is derived and rebuilt whenever the audio or the sensitivity changes; the corrections are
// in the clip file and outlive both. This resolves the two into the one list every surface should draw.

/** A correction block as `clips/*.yaml` stores it — both lists in SECONDS into the source file. */
export interface OnsetEdits {
  added?: number[];
  removed?: number[];
}

/** How close a removal must be to a detected onset to mean "that one" — a detection moves with the threshold. */
const ONSET_MATCH_S = 0.025;

const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= ONSET_MATCH_S;

/** The onsets to draw: `detected` less what was removed, plus what was added, near-duplicates collapsed. */
export function resolveOnsets(
  detected: readonly number[],
  edits: OnsetEdits | undefined,
): number[] {
  const removed = edits?.removed ?? [];
  const added = edits?.added ?? [];

  const kept = detected.filter((d) => !removed.some((r) => near(d, r)));
  const out = [...kept];
  for (const a of added) if (!out.some((k) => near(k, a))) out.push(a);
  return out.sort((x, y) => x - y);
}

/** The edits after removing the onset at `atSec` — removing an ADDED one undoes the addition. */
export function removeOnset(
  edits: OnsetEdits | undefined,
  detected: readonly number[],
  atSec: number,
): OnsetEdits {
  const added = (edits?.added ?? []).filter((a) => !near(a, atSec));
  if (added.length !== (edits?.added ?? []).length)
    return tidy({ added, removed: edits?.removed });

  // A detected one is named by the DETECTED time, so it keeps matching after a re-detection.
  const hit = detected.find((d) => near(d, atSec)) ?? atSec;
  return tidy({ added, removed: [...(edits?.removed ?? []), hit] });
}

/** The edits after adding an onset at `atSec` — dropping a removal it cancels, rather than stacking on it. */
export function addOnset(
  edits: OnsetEdits | undefined,
  atSec: number,
): OnsetEdits {
  const removed = (edits?.removed ?? []).filter((r) => !near(r, atSec));
  if (removed.length !== (edits?.removed ?? []).length)
    return tidy({ added: edits?.added, removed });
  return tidy({ added: [...(edits?.added ?? []), atSec], removed });
}

/** Moving one is removing it and adding it back elsewhere — which is what moving it is. */
export function moveOnset(
  edits: OnsetEdits | undefined,
  detected: readonly number[],
  fromSec: number,
  toSec: number,
): OnsetEdits {
  return addOnset(removeOnset(edits, detected, fromSec), toSec);
}

/** Sorted, deduplicated, and with empty lists dropped so an untouched clip writes no `onsets:` block at all. */
function tidy(e: OnsetEdits): OnsetEdits {
  const clean = (xs: number[] | undefined): number[] =>
    [...new Set(xs ?? [])].sort((a, b) => a - b);
  const added = clean(e.added);
  const removed = clean(e.removed);
  return {
    ...(added.length ? { added } : {}),
    ...(removed.length ? { removed } : {}),
  };
}
