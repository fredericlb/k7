// rows.ts — the lane layout shared by the Timeline and the Minimap: a group isn't a track
// (the compiled project keeps it in `groups` with a pointer on each member), so the
// flattening into a header plus indented members lives here rather than in either
// component. Both must be fed the same tracks — live Strudel lanes come from their own
// endpoint, so passing only `project.tracks` silently loses them and any group they fill.

import { splitPort } from "@studio/song-schema/moduleTypes";
import { HATCH } from "@studio/ui-timeline/lanes";
import type {
  WebAutomationLane,
  WebClip,
  WebGroup,
  WebProject,
  WebTrack,
  WebVideoTrack,
} from "./types";

// The hatching lives in @studio/ui-timeline, re-exported here so the two surfaces that use it keep reaching for one import.
export { HATCH };

/** The LANE behind an engine track: one wired on two ports compiles to `lane#audio` and `lane#midi`, and an order is the lane's. */
export const laneOf = (trackId: string): string => splitPort(trackId).node;

export type Row =
  | { kind: "group"; group: WebGroup }
  // `index` is the track's position in the ORIGINAL array: clustering reorders the display, not the engine's levels.
  | { kind: "track"; track: WebTrack; index: number; grouped: boolean }
  // A VIDEO lane has no engine index — picture is the renderer's — and is drawn after the audio rows, FRONT layer first.
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
  // `trackOrder` as stated, every lane — where each picture row goes among the sound rows (docs/picture.md).
  order?: readonly string[],
): Row[] {
  const byId = new Map(project.groups.map((g) => [g.id, g]));
  const members = new Map<string, { track: WebTrack; index: number }[]>();
  tracks.forEach((track, index) => {
    if (!byId.has(track.group)) return;
    const list = members.get(track.group);
    if (list) list.push({ track, index });
    else members.set(track.group, [{ track, index }]);
  });

  // The sound rows in UNITS — a lane with its automation, or a group with its members — since a picture row never splits one.
  const units: { lanes: string[]; rows: Row[] }[] = [];
  const done = new Set<string>();
  const laneRows = (track: WebTrack, index: number, grouped: boolean) => [
    { kind: "track" as const, track, index, grouped },
    ...(automation[track.id] ?? []).map((lane) => ({
      kind: "automation" as const,
      track,
      lane,
    })),
  ];
  tracks.forEach((track, index) => {
    const group = byId.get(track.group);
    if (!group) {
      units.push({
        lanes: [laneOf(track.id)],
        rows: laneRows(track, index, false),
      });
      return;
    }
    if (done.has(group.id)) return; // already emitted with its header
    done.add(group.id);
    const list = members.get(group.id) ?? [];
    units.push({
      lanes: [group.id, ...list.map((m) => laneOf(m.track.id))],
      rows: [
        { kind: "group", group },
        ...list.flatMap((m) => laneRows(m.track, m.index, true)),
      ],
    });
  });

  // Picture rows top first — the document is bottom-first, and a row above another is IN FRONT of it (docs/picture.md).
  const pictures: Row[] = [...videoTracks]
    .reverse()
    .map((track) => ({ kind: "video", track }));
  // Each picture row after the last sound lane `trackOrder` lists before it; before them all, on top; unlisted, at the bottom.
  const at = new Map((order ?? []).map((id, i) => [id, i]));
  const sound = new Set(units.flatMap((u) => u.lanes));
  const anchorOf = (id: string): string | null | undefined => {
    const i = at.get(id);
    if (i === undefined || !order) return undefined;
    for (let k = i - 1; k >= 0; k--) if (sound.has(order[k])) return order[k];
    return null;
  };
  const anchored = new Map<string | null, Row[]>();
  const unlisted: Row[] = [];
  for (const r of pictures) {
    const a = r.kind === "video" ? anchorOf(r.track.id) : undefined;
    if (a === undefined) unlisted.push(r);
    else anchored.set(a, [...(anchored.get(a) ?? []), r]);
  }
  return [
    ...(anchored.get(null) ?? []),
    ...units.flatMap((u) => [
      ...u.rows,
      ...u.lanes.flatMap((l) => anchored.get(l) ?? []),
    ]),
    ...unlisted,
  ];
}

// A row's identity, never its index, and PREFIXED by kind: a song may name an audio lane and a video lane the same thing.
export type RowKey = string; // "track:<id>" | "group:<id>" | "video:<id>" | "auto:<id>:<param>"

export const rowKey = (r: Row): RowKey =>
  r.kind === "group"
    ? `group:${r.group.id}`
    : r.kind === "video"
      ? `video:${r.track.id}`
      : r.kind === "automation"
        ? // By PARAM, which is what the binding is keyed by — one knob, one curve, so a lane
          // and its param name the row uniquely and `track automation remove` names it back.
          `auto:${r.track.id}:${r.lane.param}`
        : `track:${r.track.id}`;

/** The picture lane a row key names, or null — the ONE place `video:` is taken apart again. */
export const pictureRowId = (key: RowKey | null | undefined): string | null =>
  key?.startsWith("video:") ? key.slice("video:".length) : null;

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
  // An automation row DOES answer with its track: the knob it draws is part of that lane's sound.
  if (r.kind === "automation") return { kind: "track", id: r.track.id };
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

/** The two verbs a reorder can send: `track order` among the sound lanes, `picture lane order` among the picture lanes — both write `trackOrder`. */
export type LaneFamily = "track" | "video";

/** The lane a row's header can DRAG, or null — a group, and a live pattern lane, each state no order. */
export function orderableLane(
  row: Row,
): { family: LaneFamily; lane: string } | null {
  if (row.kind === "video") return { family: "video", lane: row.track.id };
  // The LIVE pattern lanes are appended from their own endpoint, so a row cannot tell one from a lane the project declares.
  if (row.kind === "track" && !row.track.generated)
    return { family: "track", lane: laneOf(row.track.id) };
  return null;
}

/** …and the lane a row is a DROP on: an automation row answers with the lane it belongs to. */
export function dropLaneOf(
  rows: Row[],
  key: RowKey | null | undefined,
  family: LaneFamily,
): string | null {
  const row = key ? findRow(rows, key) : undefined;
  if (!row) return null;
  if (family === "video") return row.kind === "video" ? row.track.id : null;
  // A group header is no lane, and moving one would move every member — a different act, and not this one.
  if (row.kind === "group" || row.kind === "video") return null;
  // Refused as a target for the reason it cannot be dragged: it may be a live lane, which no list holds.
  return row.track.generated ? null : laneOf(row.track.id);
}

/** The id of the lane placing `clip`, or "" when nothing does — the first lane wins, a placement being a reference. */
export function trackPlacing(
  project: WebProject | null | undefined,
  clip: string,
): string {
  if (!project || !clip) return "";
  for (const t of project.tracks)
    if (
      t.clips?.some((c) => c.id === clip) ||
      // A frozen lane's authored clips still sit on it, under the render.
      t.frozenMaterial?.some((c) => c.id === clip)
    )
      return t.id;
  return "";
}

/** The beat `clip` is placed at on lane `track`, or null. */
/** The placement on `track` playing material `ref` — a take is named by its material, its placement by `ref@start`. */
export function placementOf(
  project: WebProject | null | undefined,
  track: string,
  ref: string,
): WebClip | null {
  const lane = project?.tracks.find((t) => t.id === track);
  return (
    lane?.clips.find(
      (c) =>
        c.id === ref ||
        c.name === ref ||
        !!c.pieces?.some((p) => p.name === ref),
    ) ?? null
  );
}
