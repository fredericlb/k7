// onsets.ts — the onsets a clip actually has: what the engine detected, plus the corrections made by hand.
//
// The engine's set is derived and rebuilt whenever the audio or the sensitivity changes; the corrections are
// in the clip file and outlive both. This resolves the two into the one list every surface should draw.

/** A correction block as `clips/*.yaml` stores it — both lists in SECONDS into the source file. */
export interface OnsetEdits {
  added?: number[];
  removed?: number[];
}

/**
 * How close a removal has to be to a detected onset to be understood as "that one".
 *
 * A removal names a time, and the detector that produced that time will not reproduce it exactly at another
 * sensitivity: the same drum hit comes back a bucket earlier or later. Matching exactly would make every
 * removal fall off the moment the threshold moved — which is precisely the case this whole file exists for.
 *
 * 25 ms is a little under a 64th at 120 bpm, and comfortably wider than the bucket a detection lands in. Two
 * genuinely separate hits closer together than that are not two things a person is pointing at individually.
 */
export const ONSET_MATCH_S = 0.025;

const near = (a: number, b: number): boolean =>
  Math.abs(a - b) <= ONSET_MATCH_S;

/**
 * The onsets to draw and to slice on: `detected`, minus what was removed, plus what was added — sorted, and
 * with the near-duplicates a merge can produce collapsed.
 *
 * An addition that lands on a detected onset is dropped rather than doubled: it means the detector caught up
 * with the correction (raise the sensitivity and the hit you added by hand appears on its own), and two pins a
 * millisecond apart are one pin nobody can grab.
 */
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

/**
 * The edits after removing the onset at `atSec`.
 *
 * Removing something the user added is an UNDO of that addition, not a new removal on top of it — otherwise
 * the two lists grow against each other and the file fills with pairs that cancel out. Removing a DETECTED
 * onset is what `removed` is for.
 */
export function removeOnset(
  edits: OnsetEdits | undefined,
  detected: readonly number[],
  atSec: number,
): OnsetEdits {
  const added = (edits?.added ?? []).filter((a) => !near(a, atSec));
  if (added.length !== (edits?.added ?? []).length)
    return tidy({ added, removed: edits?.removed });

  // A detected one: name it by the DETECTED time rather than by wherever the pointer was, so the record says
  // which onset was refused and keeps matching it after a re-detection.
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
