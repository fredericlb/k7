// folder.ts — load a LEGACY flat folder project (project.yaml + tracks/clips/sequences) into
// the plain { project, tracks } shape project.ts's mapDoc consumes. No current song takes this
// path: a song has graph.yaml, and its lanes are module nodes (docs/trackModules.md), which
// compileNodeProject reads instead.

import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import {
  exportSub,
  loadProjectRoot,
  loadSettings,
  readYamlEntities,
} from "./loader";
import type {
  AssembledClip,
  AssembledDoc,
  AssembledTrack,
  RawClip,
  RawProjectRoot,
  RawSequence,
  RawTrack,
} from "./rawDoc";
import { isProjectFolder } from "./yaml/moduleIO";

// The LEGACY flat-track shape — absent on any current song.
type LegacyTrack = RawTrack & {
  role?: unknown;
  plugins?: unknown[];
  sends?: unknown[];
  /** The old flat format's own list — clip IDS, not the node model's `events:` placements. */
  clips?: unknown[];
};

// True when `abs` is a folder project (a directory with a project.yaml) or the project file itself.
export function isFolderProject(abs: string): boolean {
  try {
    const st = statSync(abs);
    if (st.isDirectory()) return isProjectFolder(abs);
    return /^project\.ya?ml$/.test(basename(abs));
  } catch {
    return false;
  }
}

export function assembleFolder(dir: string): AssembledDoc {
  const root = loadProjectRoot(dir, true); // the root file -> project, trackOrder
  // Read schema-free: no schema here describes the legacy flat track's fields.
  const tracksMap = readYamlEntities(dir, "tracks").values as Record<
    string,
    RawTrack
  >;
  const clipsMap = exportSub(dir, "clips");
  const seqMap = exportSub(dir, "sequences");
  // settings.yaml is a flat root file, so it isn't in `root` — loaded on its own for mapDoc to parse.
  return {
    ...buildDoc(dir, root, tracksMap, clipsMap, seqMap),
    settings: loadSettings(dir, true),
  };
}

// Pure assembly (no fs) — an old flat folder assembles without touching disk (see LegacyTrack).
export function buildDoc(
  dir: string,
  root: RawProjectRoot,
  tracksMap: Record<string, RawTrack>,
  clipsMap: Record<string, RawClip>,
  seqMap: Record<string, RawSequence>,
): AssembledDoc {
  const order: string[] = root.trackOrder ?? Object.keys(tracksMap);

  const tracks: AssembledTrack[] = order
    .filter((id) => tracksMap[id] && !tracksMap[id].disabled)
    .map((id) => {
      const t = tracksMap[id] as LegacyTrack;
      const clips = (t.clips ?? [])
        // Legacy: a flat track lists clip IDS here, not {ref} placements.
        .map((cid) => resolveClip(dir, String(cid), clipsMap, seqMap))
        .filter((c): c is AssembledClip => !!c);
      return {
        id,
        name: t.name ?? id,
        role: t.role,
        contentType: t.contentType,
        color: t.color,
        volume: t.volume,
        pan: t.pan,
        mute: t.mute,
        solo: t.solo,
        clips,
        // Legacy pass-through — mapDoc coerces field by field.
        plugins: (t.plugins ?? []) as AssembledTrack["plugins"],
        sends: (t.sends ?? []) as AssembledTrack["sends"],
        automation: [],
      };
    });

  // `markers` rides through untouched for mapDoc to parse.
  return { project: root.project ?? {}, tracks, markers: root.markers };
}

function resolveClip(
  dir: string,
  cid: string,
  clipsMap: Record<string, RawClip>,
  seqMap: Record<string, RawSequence>,
): AssembledClip | undefined {
  const audio = clipsMap[cid];
  if (audio) return { id: cid, ...audio };
  const seq = seqMap[cid];
  if (seq) {
    // Inline compact {t,d,k,v}; mapDoc fills the channel/rel defaults and re-reads vel.
    const notes = (Array.isArray(seq.notes) ? seq.notes : []).map(
      (n: { t?: unknown; d?: unknown; k?: unknown; v?: unknown }) => ({
        time: Number(n?.t ?? 0),
        duration: Number(n?.d ?? 0),
        key: Number(n?.k ?? 0),
        vel: Number(n?.v ?? 1),
      }),
    );
    return {
      id: cid,
      type: "midi",
      name: seq.name,
      start: seq.start ?? 0,
      length: seq.length ?? 0,
      loopStart: seq.loopStart ?? 0,
      loopEnd: seq.loopEnd ?? 0,
      notes,
    };
  }
  return undefined; // dangling ref — track simply loses this clip
}
