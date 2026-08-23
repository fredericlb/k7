// rows.ts — the lane layout shared by the Timeline and the Minimap: a group isn't a track
// (the compiled project keeps it in `groups` with a pointer on each member), so the
// flattening into a header plus indented members lives here rather than in either
// component. Both must be fed the same tracks — live Strudel lanes come from their own
// endpoint, so passing only `project.tracks` silently loses them and any group they fill.

import { HATCH } from "@studio/ui-timeline/lanes";
import type {
  WebAutomationLane,
  WebGroup,
  WebProject,
  WebTake,
  WebTrack,
  WebVideoTrack,
} from "./types";

// The hatching lives in @studio/ui-timeline, re-exported here so the two surfaces that use it keep reaching for one import.
export { HATCH };

export type Row =
  | { kind: "group"; group: WebGroup }
  // `index` is the track's position in the ORIGINAL array: clustering reorders the display, not the engine's levels.
  | { kind: "track"; track: WebTrack; index: number; grouped: boolean }
  // A TAKE of the lane above it, drawn indented and playing nothing until moved back; `n` is 1-based, as the two commands name it.
  | { kind: "take"; track: WebTrack; take: WebTake; n: number }
  // A VIDEO lane has no engine index — picture is the renderer's — and is drawn after the audio rows, in `layers:` draw order.
  | { kind: "video"; track: WebVideoTrack }
  // An AUTOMATION lane of the track above: one knob against song time, holding no material but addressing its TRACK.
  | { kind: "automation"; track: WebTrack; lane: WebAutomationLane };

/** Flatten tracks into rows, clustering a group under a header at its FIRST member; `videoTracks` comes from the PICTURE compile. */
export function projectRows(
  project: Pick<WebProject, "groups">,
  tracks: WebTrack[],
  videoTracks: WebVideoTrack[] = [],
  // Each lane's automation, by track id, from the graph — absent for a project that automates nothing, and for a caller with no graph.
  automation: Record<string, WebAutomationLane[]> = {},
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
  // A lane's takes follow it immediately, oldest first, indented one step further when the lane is grouped.
  const withTakes = (track: WebTrack, index: number, grouped: boolean) => {
    rows.push({ kind: "track", track, index, grouped });
    // Automation before the takes: a curve is part of what the lane is PLAYING, while a take is what it was.
    for (const lane of automation[track.id] ?? [])
      rows.push({ kind: "automation", track, lane });
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

  // Video lanes last, as their own block: no group, no engine index, and the renderer stacks them in their own order.
  for (const track of videoTracks) rows.push({ kind: "video", track });

  return rows;
}

// A row's identity, never its index, and PREFIXED by kind: a song may name an audio lane and a video lane the same thing.
export type RowKey = string; // "track:<id>" | "group:<id>" | "video:<id>" | "take:<id>:<n>" | "auto:<id>:<param>"

export const rowKey = (r: Row): RowKey =>
  r.kind === "group"
    ? `group:${r.group.id}`
    : r.kind === "video"
      ? `video:${r.track.id}`
      : r.kind === "take"
        ? // By NUMBER, not by contents: a take has no id, and its number is what the commands
          // name it by. Selecting one renumbers nothing — the swap keeps every take in place.
          `take:${r.track.id}:${r.n}`
        : r.kind === "automation"
          ? // By PARAM, which is what the binding is keyed by — one knob, one curve, so a lane
            // and its param name the row uniquely and `track automation remove` names it back.
            `auto:${r.track.id}:${r.lane.param}`
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

/** The entity behind a row, or null when it has none — a generated lane redirects to its GROUP, and a VIDEO lane answers with its own kind (docs/timeline.md). */
export function rowTarget(r: Row): RowTarget | null {
  if (r.kind === "group") return { kind: "group", id: r.group.id };
  if (r.kind === "video") return { kind: "video", id: r.track.id };
  // An automation row DOES answer with its track, unlike a take: the knob it draws is part of that lane's sound.
  if (r.kind === "automation") return { kind: "track", id: r.track.id };
  // A TAKE points at nothing: it is not playing, and answering with its lane would mute the LANE from a take's own header.
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
