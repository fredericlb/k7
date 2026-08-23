// videoProject.ts — a song's folder read as PICTURE: the viewport, the lanes in draw order, and
// the markers, every position in decimal SECONDS. The same loader as the song compile, over the
// same folder; what differs is which entities are looked at and what the numbers mean.
// See docs/picture.md.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadGraph } from "./graph";
import { loadProjectRoot, loadVideoTracks, readYamlEntities } from "./loader";
import type { RawClip } from "./rawDoc";
import { compileVideoChains } from "./videoChains";
import type { VideoMarker, VideoProjectDoc } from "./videoDoc";
import { compileVideoTracks, readViewport } from "./videoTracks";

/**
 * A wall-clock position -> seconds: `90`, `12.5`, `1:30`, `1:30.5`.
 *
 * Minutes and seconds only. Hours are not modelled and that is a decision, not an omission:
 * a `1:30:00` would be indistinguishable from a musical `bar:beat:tick`, and the two dialects
 * share one `markers:` schema. A three-hour cut writes `10800`.
 */
export function parseWallClock(tc: string): number | null {
  const s = tc.trim();
  if (/^[0-9]+(\.[0-9]+)?$/.test(s)) return Number(s);
  const m = /^([0-9]+):([0-5][0-9](?:\.[0-9]+)?)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `markers:` read as wall-clock points, sorted. An unparseable key is skipped, not fatal — a
 *  marker is a label, and losing the whole project over one is the wrong trade. */
export function parseVideoMarkers(raw: unknown): VideoMarker[] {
  if (!raw || typeof raw !== "object") return [];
  const out: VideoMarker[] = [];
  for (const [tc, name] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof name !== "string") continue;
    const sec = parseWallClock(tc);
    if (sec === null) continue;
    out.push({ sec, name, tc });
  }
  return out.sort((a, b) => a.sec - b.sec);
}

/**
 * Compile the PICTURE of the project at `dir`.
 *
 * A folder, always — there is no single-file form of picture, because a stack of lanes is a
 * folder by construction. `viewport:` is required and says so by name when it is missing: it
 * is the one setting with no defensible default (a frame invented by the loader would silently
 * letterbox every shot in the project).
 *
 * Callers that may be handed a song with no picture at all should ask `isVideoProject` first —
 * "this song has no video lanes" and "this song's picture will not compile" are two answers,
 * and only the second one is this function's to give.
 */
export function loadVideoProject(dir: string): VideoProjectDoc {
  const abs = resolve(dir);
  const root = loadProjectRoot(abs, true);
  const proj = (root.project ?? {}) as Record<string, unknown>;

  const { viewport, fps } = readViewport(proj);
  if (!viewport[0] || !viewport[1])
    throw new Error(
      "project.viewport is required in a v1 project — set `viewport: [1280, 720, 30]` (width, height, export fps)",
    );

  // Read WITH their issues, as the song compiler does: a clip file the schema rejects drops out
  // of the map, and its own complaint is what stops the symptom reading as "ref not found"
  // about a file sitting right there.
  const clipsMap = readYamlEntities(abs, "clips").values as Record<
    string,
    RawClip
  >;
  const videoTracksMap = loadVideoTracks(abs, true);
  const tracks = compileVideoTracks(abs, proj.layers, videoTracksMap, clipsMap);

  /**
   * The video CHAINS, which is the one thing here that reads `graph.yaml`.
   *
   * Best-effort, and that is the whole of the decision: a graph that will not parse is already
   * reported by the song compile, in the editor, on the line that broke — and the picture has no
   * business refusing to draw because of it. Losing the effects is recoverable by looking at the
   * other error; losing the frame is a black screen with no explanation. See docs/shaders.md.
   */
  const chains = (() => {
    try {
      return compileVideoChains(abs, loadGraph(abs));
    } catch {
      return { byLane: {}, frame: [] };
    }
  })();

  return {
    ...(typeof proj.uuid === "string" ? { uuid: proj.uuid } : {}),
    name: String(proj.name ?? "untitled"),
    viewport,
    fps,
    videoTracks: tracks.map((t) =>
      chains.byLane[t.id] ? { ...t, plugins: chains.byLane[t.id] } : t,
    ),
    markers: parseVideoMarkers(root.markers),
    framePlugins: chains.frame,
  };
}

/** Whether `dir` carries picture at all — the cheap check a caller makes before compiling. */
export function isVideoProject(dir: string): boolean {
  return existsSync(resolve(dir, "video_tracks"));
}
