// trackModule.ts — the three modules a LANE is a node of. Like `@meta/doc` none of them has a
// file anywhere, so a lane costs exactly its own node and nothing else. A lane is NOT typed by
// the signal it carries: it offers an `audio` and a `midi` output, and each event leaves by the
// one its own material fits. Rationale: docs/trackModules.md.

import {
  GROUP_TRACK_REF,
  STRUDEL_TRACK_REF,
  TRACK_CATEGORY,
  TRACK_OUTPUTS,
  TRACK_REF,
  TRACK_REFS,
} from "@studio/song-schema/moduleTypes";
import type { LoadedModule, RawPlacement } from "./rawDoc";

export {
  GROUP_TRACK_REF,
  isTrackRef,
  LEGACY_TRACK_REFS,
  STRUDEL_TRACK_REF,
  TRACK_CATEGORY,
  TRACK_OUT_AUDIO,
  TRACK_OUT_MIDI,
  TRACK_OUTPUTS,
  TRACK_REF,
  TRACK_REFS,
} from "@studio/song-schema/moduleTypes";

/** What tells the three apart, and the only thing that does — see docs/trackModules.md. */
interface TrackShape {
  group?: boolean;
  generated?: boolean;
}

const SHAPES: Record<string, TrackShape> = {
  [TRACK_REF]: {},
  [STRUDEL_TRACK_REF]: { generated: true },
  [GROUP_TRACK_REF]: { group: true },
};

/** One built-in as the ref map holds it: no input, two outputs, none for a group — docs/trackModules.md. */
function trackModule(ref: string): LoadedModule {
  const { group, generated } = SHAPES[ref];
  return {
    kind: "track",
    category: TRACK_CATEGORY,
    inputs: [],
    // Audio first — what a bare cable means, and the order the graph draws the jacks in.
    outputs: group ? [] : TRACK_OUTPUTS.map((o) => ({ ...o })),
    generated: generated || undefined,
    file: ref.slice(ref.lastIndexOf("/") + 1),
  };
}

/** The three built-in refs, for the ref map to start from. */
export const trackModules = (): Record<string, LoadedModule> =>
  Object.fromEntries(TRACK_REFS.map((ref) => [ref, trackModule(ref)]));

/** Is this resolved module a LANE? What every surface asks before drawing one. */
export const isTrack = (m: { kind?: unknown } | null | undefined): boolean =>
  m?.kind === "track";

/** A GROUP lane, asked by PORT rather than by ref so a node of one is still a group. */
export const isGroupTrack = (
  m: { kind?: unknown; outputs?: readonly unknown[] } | null | undefined,
): boolean => isTrack(m) && (m?.outputs?.length ?? 0) === 0;

/** A resolved lane module read as an ARRANGEMENT — the ONE projection, see docs/trackModules.md. */
export interface Lane {
  type: "single" | "group" | "strudel";
  color?: string;
  /** As AUTHORED — timecodes still strings. Empty for a group and for a generated lane. */
  events: RawPlacement[];
  /** A group's members, by node name. Empty for every other kind. */
  tracks: string[];
  /** A generated lane's pattern file, project-relative. */
  strudel?: string;
  /** The PICTURE lane whose shots this lane plays the sound of — docs/videoSound.md. */
  videoSource?: string;
  /** Left out of the render entirely, chains and all. */
  disabled: boolean;
}

/** `m` seen as a lane, or null when it is not one. */
export function laneOf(m: LoadedModule | undefined | null): Lane | null {
  if (!isTrack(m) || !m) return null;
  const group = isGroupTrack(m);
  const strudel = m.generated === true;
  return {
    type: group ? "group" : strudel ? "strudel" : "single",
    color: typeof m.color === "string" && m.color ? m.color : undefined,
    events:
      group || strudel || !Array.isArray(m.events)
        ? []
        : (m.events as RawPlacement[]),
    tracks: group && Array.isArray(m.tracks) ? m.tracks.map(String) : [],
    strudel:
      strudel && typeof m.strudel === "string" && m.strudel
        ? m.strudel
        : undefined,
    videoSource:
      !group && !strudel && typeof m.video_source === "string" && m.video_source
        ? m.video_source
        : undefined,
    disabled: m.disabled === true,
  };
}

/** Every lane in a RESOLVED module map, keyed by node name and in that map's order. */
export function lanesOf(
  modules: Record<string, LoadedModule>,
): Record<string, Lane> {
  const out: Record<string, Lane> = {};
  for (const [name, m] of Object.entries(modules)) {
    const lane = laneOf(m);
    if (lane) out[name] = lane;
  }
  return out;
}

/** What one event's ref resolves to. `missing` names nothing the project holds. */
export type Material = "audio" | "midi" | "missing";

/** Which materials a list of events actually holds — a summary nothing stores. */
export interface LaneMaterials {
  audio: boolean;
  midi: boolean;
  missing: boolean;
}

// What a lane holds, event by event; a GENERATED lane answers "neither", so only its wiring settles it.
export function laneMaterials(
  events: readonly RawPlacement[],
  materialOf: (ref: string) => Material,
): LaneMaterials {
  const out: LaneMaterials = { audio: false, midi: false, missing: false };
  for (const p of events) out[materialOf(String(p?.ref ?? ""))] = true;
  return out;
}

/** The ONE signal a lane puts on a wire, undefined when it can't be said — a caller skips those. */
export function laneSignal(m: LaneMaterials): "audio" | "midi" | undefined {
  if (m.missing) return undefined;
  if (m.audio && m.midi) return undefined;
  return m.audio ? "audio" : m.midi ? "midi" : undefined;
}
