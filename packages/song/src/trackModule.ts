// trackModule.ts — the three modules a LANE is a node of. Like `@studio/doc` none of them has a
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

/**
 * What tells the three apart, and the only thing that does.
 *
 * `group` holds member names and carries nothing, which is why it has no port at all — the one
 * axis a lane still has. `generated` says where the events come from: written down in `events:`,
 * or streamed from `strudel:` while the transport rolls.
 */
interface TrackShape {
  group?: boolean;
  generated?: boolean;
}

const SHAPES: Record<string, TrackShape> = {
  [TRACK_REF]: {},
  [STRUDEL_TRACK_REF]: { generated: true },
  [GROUP_TRACK_REF]: { group: true },
};

/**
 * One built-in, as the ref map holds it — shaped like the io modules `engineCatalogue`
 * synthesises, because a module with no folder still answers the same questions as one with a
 * folder.
 *
 * NO input on any of the three: what arrives on a lane is its events. A live interface channel is
 * the one thing that may be routed into one, and the compiler lands it on the lane rather than
 * feeding a port — see MODULE_TYPES.tracks for why that stayed as it was.
 *
 * TWO OUTPUTS, and this is the whole of detyping: a lane holds events naming clips and events
 * naming sequences, in one list, and each leaves by the port its material fits. Wire one port and
 * the lane is what it always was; wire both and it is a lane playing a riff through an amp and a
 * line through a synth, which used to take two lanes and a rule about which was which.
 *
 * A group offers no output at all: it holds member names and carries no signal, which is the
 * same fact its old `type: group` stated, said with a port list instead of a word.
 */
function trackModule(ref: string): LoadedModule {
  const { group, generated } = SHAPES[ref];
  return {
    kind: "track",
    category: TRACK_CATEGORY,
    inputs: [],
    // Audio first — the order is what a bare cable means (it lands on the first output) and the
    // order the graph draws the jacks in, orange then blue.
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

/**
 * A GROUP lane — one that holds member names and carries no signal.
 *
 * Asked by port rather than by ref, so a node that extends a node of a group is still
 * a group: `extends` is folded before anything reads this, and the ports are what survive.
 */
export const isGroupTrack = (
  m: { kind?: unknown; outputs?: readonly unknown[] } | null | undefined,
): boolean => isTrack(m) && (m?.outputs?.length ?? 0) === 0;

/**
 * A resolved lane module, read as an ARRANGEMENT — the authored fields, sorted out.
 *
 * The ONE projection, here rather than in the two places that need it. `graph.ts` turns it into
 * the `Track` every surface draws (timecodes parsed to beats) and `nodeProject.ts` compiles it
 * for the engine (placements kept as authored); both ask the same question of the same module,
 * and a second copy of "is this a group" is exactly how the two would come to disagree.
 *
 * Note what decides each kind: a GROUP is one with no output port, a GENERATED lane one whose
 * module says so. Neither is read off a word in the file — `type:` and `contentType:` are gone,
 * and what the lane extends is the whole answer.
 *
 * There is no `contentType` HERE either, and that is the point: what a lane holds is a property
 * of each event, not of the lane. Ask `laneMaterials()` when you need the summary.
 */
export interface Lane {
  type: "single" | "group" | "strudel";
  color?: string;
  /** As AUTHORED — timecodes still strings. Empty for a group and for a generated lane. */
  events: RawPlacement[];
  /**
   * The lane's TAKES: previous arrangements, each the same list `events` is (docs/takes.md).
   *
   * Read here beside `events` and by the same rule, which is what makes a take belong to the
   * alternative it was played in — the resolver folds the selected set before any of this, so a
   * lane running one sees its takes and not the module's.
   */
  takes: { name?: string; events: RawPlacement[] }[];
  /** A group's members, by node name. Empty for every other kind. */
  tracks: string[];
  /** A generated lane's pattern file, project-relative. */
  strudel?: string;
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
    takes:
      group || strudel || !Array.isArray(m.takes)
        ? []
        : (m.takes as { name?: string; events: RawPlacement[] }[]).map((t) => ({
            ...(t?.name ? { name: t.name } : {}),
            events: Array.isArray(t?.events) ? t.events : [],
          })),
    tracks: group && Array.isArray(m.tracks) ? m.tracks.map(String) : [],
    strudel:
      strudel && typeof m.strudel === "string" && m.strudel
        ? m.strudel
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

/** Which materials a list of events actually holds — the summary nothing stores any more. */
export interface LaneMaterials {
  audio: boolean;
  midi: boolean;
  missing: boolean;
}

// What a lane holds, event by event. A generated lane answers "neither": its material arrives
// while the transport rolls, so the file cannot say, and only the WIRING settles its ports.
export function laneMaterials(
  events: readonly RawPlacement[],
  materialOf: (ref: string) => Material,
): LaneMaterials {
  const out: LaneMaterials = { audio: false, midi: false, missing: false };
  for (const p of events) out[materialOf(String(p?.ref ?? ""))] = true;
  return out;
}

/**
 * The ONE signal a lane puts on a wire, or undefined when it can't be said.
 *
 * Undefined for an empty lane, a generated one, a lane whose refs resolve to nothing, and — the
 * new case — a lane holding both. A caller checking a port's type skips an undefined rather than
 * guessing, which is what it already did for every other unknowable source.
 */
export function laneSignal(m: LaneMaterials): "audio" | "midi" | undefined {
  if (m.missing) return undefined;
  if (m.audio && m.midi) return undefined;
  return m.audio ? "audio" : m.midi ? "midi" : undefined;
}
