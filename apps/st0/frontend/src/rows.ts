// rows.ts — the lane layout shared by the Timeline and the Minimap: a group isn't a track
// (the compiled project keeps it in `groups` with a pointer on each member), so the
// flattening into a header plus indented members lives here rather than in either
// component. Both must be fed the same tracks — live Strudel lanes come from their own
// endpoint, so passing only `project.tracks` silently loses them and any group they fill.

import { HATCH } from "@studio/ui-timeline/lanes";
import type {
  WebGroup,
  WebProject,
  WebTake,
  WebTrack,
  WebVideoTrack,
} from "./types";

// The hatching lives in @studio/ui-timeline; re-exported here so the two surfaces that use it
// keep reaching for one import.
export { HATCH };

export type Row =
  | { kind: "group"; group: WebGroup }
  // `index` is the track's position in the ORIGINAL array: clustering reorders the display, not the engine's levels.
  | { kind: "track"; track: WebTrack; index: number; grouped: boolean }
  // A TAKE of the lane above it: what that lane WAS playing, drawn indented under it and
  // playing nothing until it is moved back onto the track. `n` is 1-based — it is the number
  // the two `track take …` commands name it by. See packages/song/docs/takes.md.
  | { kind: "take"; track: WebTrack; take: WebTake; n: number }
  // A VIDEO lane has no engine index — picture is the renderer's — and is drawn after the audio
  // rows, in the `layers:` draw order the picture compile already put them in.
  | { kind: "video"; track: WebVideoTrack };

/**
 * Flatten tracks into rows, clustering a group's members under a header placed where its FIRST
 * member sits. A dangling `group` pointer draws as a plain track: the surfaces show what the
 * song has, not what it should.
 *
 * `videoTracks` comes from the PICTURE compile (`GET /video-doc`) and not from `project`, which
 * is the whole shape of how picture lives in a song now: one folder, two documents, and the one
 * the engine is handed carries no frame at all.
 */
export function projectRows(
  project: Pick<WebProject, "groups">,
  tracks: WebTrack[],
  videoTracks: WebVideoTrack[] = [],
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
  // A lane's takes follow it immediately, oldest first — they belong under the lane they came
  // off, and a take of a grouped lane is indented one step further than the lane is.
  const withTakes = (track: WebTrack, index: number, grouped: boolean) => {
    rows.push({ kind: "track", track, index, grouped });
    (track.takes ?? []).forEach((take, i) =>
      rows.push({ kind: "take", track, take, n: i + 1 }),
    );
  };
  tracks.forEach((track, index) => {
    const group = byId.get(track.group);
    if (!group) {
      withTakes(track, index, false);
      return;
    }
    if (done.has(group.id)) return; // already emitted with its header
    done.add(group.id);
    rows.push({ kind: "group", group });
    for (const m of members.get(group.id) ?? [])
      withTakes(m.track, m.index, true);
  });

  // Video lanes last, as their own block: no group, no engine index, and the renderer stacks
  // them in their own order.
  for (const track of videoTracks) rows.push({ kind: "video", track });

  return rows;
}

// A row's identity, never its index: live lanes come and go, and an index caret would slide onto another lane.
// PREFIXED by kind, not bare: a song may name an audio lane and a video lane the same thing, and
// they are two rows.
export type RowKey = string; // "track:<id>" | "group:<id>" | "video:<id>" | "take:<id>:<n>"

export const rowKey = (r: Row): RowKey =>
  r.kind === "group"
    ? `group:${r.group.id}`
    : r.kind === "video"
      ? `video:${r.track.id}`
      : r.kind === "take"
        ? // By NUMBER, not by contents: a take has no id, and its number is what the commands
          // name it by. Selecting one renumbers nothing — the swap keeps every take in place.
          `take:${r.track.id}:${r.n}`
        : `track:${r.track.id}`;

export const rowIndexOf = (rows: Row[], key: RowKey): number =>
  rows.findIndex((r) => rowKey(r) === key);

export const findRow = (rows: Row[], key: RowKey): Row | undefined =>
  rows.find((r) => rowKey(r) === key);

// Whether a row can hold the caret on a BEAT — only a lane that can carry a clip; the rest are label-only.
export const isCellRow = (r: Row): boolean =>
  r.kind === "track" && !r.track.generated;

// What a row ADDRESSES: the entity a command, a file open or a graph lookup should name for it.
export type RowTarget = { kind: "track" | "group" | "video"; id: string };

/**
 * The entity behind a row, or null when it has none.
 *
 * A generated lane redirects to its GROUP, which is the same redirect mute/solo make (see
 * `apps/st0/frontend/docs/timeline.md`) and for the same reason: the lane is synthesized per
 * tick, so it has no file to open and no chain of its own to draw. A group with no id — a
 * lane streaming from nowhere — has nothing to point at at all.
 *
 * A VIDEO lane answers with its own kind rather than passing for a track, because everything
 * downstream of this asks the engine something: a level to draw, an arm to toggle, a chain to
 * look up. Picture has none of those, and the honest answer is a kind the caller can refuse.
 */
export function rowTarget(r: Row): RowTarget | null {
  if (r.kind === "group") return { kind: "group", id: r.group.id };
  if (r.kind === "video") return { kind: "video", id: r.track.id };
  // A TAKE points at nothing. Everything downstream of this asks the engine something — a level,
  // an arm, a chain — and a take is not playing: answering with its lane would put the caret's
  // marks on a row that cannot act on them, and mute the LANE from a take's own header.
  if (r.kind === "take") return null;
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
