// trackModule.ts — the five modules a LANE is a node of. Like `@studio/doc` none of them
// has a file anywhere, so a lane costs exactly its own node and nothing else. They are built
// from one two-axis table, not five literals: the grid IS the vocabulary, and five hand-written
// copies is where the audio and sequence halves start to drift. Rationale: docs/trackModules.md.

import {
  AUDIO_STRUDEL_TRACK_REF,
  AUDIO_TRACK_REF,
  GROUP_TRACK_REF,
  SEQUENCE_STRUDEL_TRACK_REF,
  SEQUENCE_TRACK_REF,
  TRACK_CATEGORY,
  TRACK_REFS,
} from "./moduleTypes";
import type { LoadedModule, RawPlacement } from "./rawDoc";

export {
  AUDIO_STRUDEL_TRACK_REF,
  AUDIO_TRACK_REF,
  GROUP_TRACK_REF,
  isTrackRef,
  SEQUENCE_STRUDEL_TRACK_REF,
  SEQUENCE_TRACK_REF,
  TRACK_CATEGORY,
  TRACK_REFS,
} from "./moduleTypes";

/**
 * What tells the five apart, and the only thing that does.
 *
 * `signal` is null for a group: it holds member names and carries nothing, which is why it has
 * neither port. `generated` says where the lane's clips come from — written down in `clips:`, or
 * streamed from `strudel:` while the transport rolls.
 */
interface TrackShape {
  signal: "audio" | "midi" | null;
  generated: boolean;
}

const SHAPES: Record<string, TrackShape> = {
  [AUDIO_TRACK_REF]: { signal: "audio", generated: false },
  [SEQUENCE_TRACK_REF]: { signal: "midi", generated: false },
  [AUDIO_STRUDEL_TRACK_REF]: { signal: "audio", generated: true },
  [SEQUENCE_STRUDEL_TRACK_REF]: { signal: "midi", generated: true },
  [GROUP_TRACK_REF]: { signal: null, generated: false },
};

/**
 * One built-in, as the ref map holds it — shaped like the io modules `engineCatalogue`
 * synthesises, because a module with no folder still answers the same questions as one with a
 * folder.
 *
 * NO input on any of the five: what arrives on a lane is its clips. A live interface channel is
 * the one thing that may be routed into one, and the compiler lands it on the lane rather than
 * feeding a port — see MODULE_TYPES.tracks for why that stayed as it was.
 *
 * A group offers no OUTPUT either: it holds member names and carries no signal, which is the
 * same fact its old `type: group` stated, said with a port list instead of a word.
 */
function trackModule(ref: string): LoadedModule {
  const { signal, generated } = SHAPES[ref];
  return {
    kind: "track",
    category: TRACK_CATEGORY,
    inputs: [],
    outputs: signal ? [{ name: "out", type: signal }] : [],
    generated: generated || undefined,
    file: ref.slice(ref.lastIndexOf("/") + 1),
  };
}

/** The five built-in refs, for the ref map to start from. */
export const trackModules = (): Record<string, LoadedModule> =>
  Object.fromEntries(TRACK_REFS.map((ref) => [ref, trackModule(ref)]));

/** Is this resolved module a LANE? What every surface asks before drawing one. */
export const isTrack = (m: { kind?: unknown } | null | undefined): boolean =>
  m?.kind === "track";

/** …and is it one whose clips are STREAMED rather than written down (a strudel lane)? */
export const isGeneratedTrack = (
  m: { kind?: unknown; generated?: unknown } | null | undefined,
): boolean => isTrack(m) && m?.generated === true;

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
 */
export interface Lane {
  type: "single" | "group" | "strudel";
  contentType: "audio" | "sequences";
  color?: string;
  /** As AUTHORED — timecodes still strings. Empty for a group and for a generated lane. */
  clips: RawPlacement[];
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
    contentType: m.outputs?.[0]?.type === "midi" ? "sequences" : "audio",
    color: typeof m.color === "string" && m.color ? m.color : undefined,
    clips:
      group || strudel || !Array.isArray(m.clips)
        ? []
        : (m.clips as RawPlacement[]),
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
