// rows.ts — the lane layout shared by the Timeline and the Minimap: a group isn't a track
// (the compiled project keeps it in `groups` with a pointer on each member), so the
// flattening into a header plus indented members lives here rather than in either
// component. Both must be fed the same tracks — live Strudel lanes come from their own
// endpoint, so passing only `project.tracks` silently loses them and any group they fill.

import { HATCH } from "@studio/ui-timeline/lanes";
import type { WebGroup, WebProject, WebTrack } from "./types";

// The hatching moved to @studio/ui-timeline when v1 started drawing lanes too; re-exported
// here so the two surfaces that use it keep reaching for one import.
export { HATCH };

export type Row =
  | { kind: "group"; group: WebGroup }
  // `index` is the track's position in the ORIGINAL array: clustering reorders the display, not the engine's levels.
  | { kind: "track"; track: WebTrack; index: number; grouped: boolean };

// Flatten tracks into rows, clustering a group's members under a header placed where its FIRST member sits.
// A dangling `group` pointer draws as a plain track: the surfaces show what the song has, not what it should.
export function projectRows(
  project: Pick<WebProject, "groups">,
  tracks: WebTrack[],
): Row[] {
  const byId = new Map(project.groups.map((g) => [g.id, g]));
  const members = new Map<string, { track: WebTrack; index: number }[]>();
  tracks.forEach((track, index) => {
    if (!byId.has(track.group)) return;
    const list = members.get(track.group);
    if (list) list.push({ track, index });
    else members.set(track.group, [{ track, index }]);
  });

  const rows: Row[] = [];
  const done = new Set<string>();
  tracks.forEach((track, index) => {
    const group = byId.get(track.group);
    if (!group) {
      rows.push({ kind: "track", track, index, grouped: false });
      return;
    }
    if (done.has(group.id)) return; // already emitted with its header
    done.add(group.id);
    rows.push({ kind: "group", group });
    for (const m of members.get(group.id) ?? [])
      rows.push({
        kind: "track",
        track: m.track,
        index: m.index,
        grouped: true,
      });
  });

  return rows;
}

// A row's identity, never its index: live lanes come and go, and an index caret would slide onto another lane.
export type RowKey = string; // "track:<id>" | "group:<id>"

export const rowKey = (r: Row): RowKey =>
  r.kind === "group" ? `group:${r.group.id}` : `track:${r.track.id}`;

export const rowIndexOf = (rows: Row[], key: RowKey): number =>
  rows.findIndex((r) => rowKey(r) === key);

export const findRow = (rows: Row[], key: RowKey): Row | undefined =>
  rows.find((r) => rowKey(r) === key);

// Whether a row can hold the caret on a BEAT — only a lane that can carry a clip; the rest are label-only.
export const isCellRow = (r: Row): boolean =>
  r.kind === "track" && !r.track.generated;

// What a row ADDRESSES: the entity a command, a file open or a graph lookup should name for it.
export type RowTarget = { kind: "track" | "group"; id: string };

/**
 * The entity behind a row, or null when it has none.
 *
 * A generated lane redirects to its GROUP, which is the same redirect mute/solo make (see
 * `apps/l8/frontend/docs/timeline.md`) and for the same reason: the lane is synthesized per
 * tick, so it has no file to open and no chain of its own to draw. A group with no id — a
 * lane streaming from nowhere — has nothing to point at at all.
 */
export function rowTarget(r: Row): RowTarget | null {
  if (r.kind === "group") return { kind: "group", id: r.group.id };
  if (r.track.generated)
    return r.track.group ? { kind: "group", id: r.track.group } : null;
  return { kind: "track", id: r.track.id };
}

// The nearest row `delta` away that `can` accepts, stopping at the ends; returns `key` when there is nowhere to go.
export function stepRow(
  rows: Row[],
  key: RowKey,
  delta: number,
  can: (r: Row) => boolean = () => true,
): RowKey {
  const at = rowIndexOf(rows, key);
  if (at < 0) return key;
  for (let i = at + delta; i >= 0 && i < rows.length; i += delta)
    if (can(rows[i])) return rowKey(rows[i]);
  return key;
}
