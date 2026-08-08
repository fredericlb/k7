// videoProject.ts — a `*.v1` folder read into a VideoProjectDoc: the viewport, the lanes in
// draw order, and the markers, every position in decimal SECONDS. The same loader as a song
// reads the same folder shape; what differs is which entities are looked at and what the
// numbers mean. See docs/v1Project.md.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadProjectRoot, loadVideoTracks, readYamlEntities } from "./loader";
import type { RawClip } from "./rawDoc";
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
 * Compile the `*.v1` project at `dir`.
 *
 * A folder, always — there is no single-file form of a cut, because a cut is a folder of
 * lanes by construction. `viewport:` is required and says so by name when it is missing: it
 * is the one setting with no defensible default (a frame invented by the loader would silently
 * letterbox every shot in the project).
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

  return {
    ...(typeof proj.uuid === "string" ? { uuid: proj.uuid } : {}),
    name: String(proj.name ?? "untitled"),
    viewport,
    fps,
    videoTracks: compileVideoTracks(abs, proj.layers, videoTracksMap, clipsMap),
    markers: parseVideoMarkers(root.markers),
  };
}

/** Whether `dir` looks like a v1 project at all — the cheap check a caller makes before compiling. */
export function isVideoProject(dir: string): boolean {
  return existsSync(resolve(dir, "video_tracks"));
}
