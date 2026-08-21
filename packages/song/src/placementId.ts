// placementId.ts — a clip's id: the material it plays, and WHERE it plays. Two functions and no
// imports, so a BROWSER can hold the rule: it is written by the compiler, logged by the engine,
// carried on `/waveform`, and read back by every surface that has to find the file behind a clip.
//
// It lived in nodeProject.ts, which reaches for `node:fs` and `node:child_process` — the same
// reason `graph-model` was split out. Re-exported from there, so nothing that had it moved.

/**
 * A placement's id: the material it plays, and WHERE it plays.
 *
 * Two placements of one material are the ordinary case — a split makes a pair of them, and any
 * lane may drop the same sample twice — so the material's name alone cannot identify one. The
 * start does, because two placements cannot begin at the same beat on one lane without being the
 * same placement.
 *
 * `@` and the start IN BEATS. Start rather than an index into `events:` because the list's order
 * is not meaningful: a split appends its tail, so an index would renumber the neighbours of every
 * cut. Moving a clip does change this id, and that costs nothing — `clipMoved` already re-inserts
 * on a changed `start`, so the engine was going to rebuild it either way.
 *
 * Readable on purpose: it is what the engine logs and what a `/waveform` request carries.
 */
export function placementId(ref: string, startBeats: number): string {
  return `${ref}@${startBeats}`;
}

/**
 * The MATERIAL a placement id names — `bass_2_0@16` → `bass_2_0`.
 *
 * The inverse of `placementId`, for the readers that want the file rather than the placement: a
 * clip's own `clips/<ref>.yaml`, its onset corrections, and the editor asked to open "the clip's
 * own definition" from a right-click. All are properties of the material, shared by every
 * placement of it.
 *
 * Split on the LAST `@`, and only when what follows is a number. A ref may legitimately contain
 * one — nothing forbids it in an entity name — and a string this cannot parse is returned whole,
 * which is the right answer for the material names this is also handed directly.
 */
export function materialRefOf(clipId: string): string {
  const at = clipId.lastIndexOf("@");
  if (at <= 0) return clipId;
  const tail = clipId.slice(at + 1);
  return tail !== "" && Number.isFinite(Number(tail))
    ? clipId.slice(0, at)
    : clipId;
}
