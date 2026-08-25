// videoProject.ts — a song's folder read as PICTURE: the viewport, the lanes in draw order, and
// the markers, every position in decimal SECONDS. The same loader as the song compile, over the
// same folder; what differs is which entities are looked at and what the numbers mean.
// See docs/picture.md.

import { resolve } from "node:path";
import { loadGraph } from "@studio/song/graph";
import {
  loadModuleRefs,
  loadProjectRoot,
  loadVideoTracks,
  readYamlEntities,
} from "@studio/song/loader";
import type { RawClip } from "@studio/song/rawDoc";
import { compileVideoChains } from "./videoChains";
import type { VideoMarker, VideoProjectDoc } from "./videoDoc";
import { compileVideoTracks, readViewport } from "./videoTracks";
import { collectTransitions } from "./videoTransitions";

/** A wall-clock position -> seconds; minutes and seconds only, since `1:30:00` would read as `bar:beat:tick`. */
export function parseWallClock(tc: string): number | null {
  const s = tc.trim();
  if (/^[0-9]+(\.[0-9]+)?$/.test(s)) return Number(s);
  const m = /^([0-9]+):([0-5][0-9](?:\.[0-9]+)?)$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** `markers:` read as wall-clock points, sorted; an unparseable key is skipped rather than fatal. */
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

/** Compile the PICTURE of the project at `dir` — a folder always, and `viewport:` is required. */
export function loadVideoProject(dir: string): VideoProjectDoc {
  const abs = resolve(dir);
  const root = loadProjectRoot(abs, true);
  const proj = (root.project ?? {}) as Record<string, unknown>;

  const { viewport, fps } = readViewport(proj);
  if (!viewport[0] || !viewport[1])
    throw new Error(
      "project.viewport is required in a v1 project — set `viewport: [1280, 720, 30]` (width, height, export fps)",
    );

  // Read WITH their issues, as the song compiler does, so a rejected clip complains about itself.
  const clipsMap = readYamlEntities(abs, "clips").values as Record<
    string,
    RawClip
  >;
  const videoTracksMap = loadVideoTracks(abs, true);
  const tracks = compileVideoTracks(abs, proj.layers, videoTracksMap, clipsMap);

  // The video CHAINS, the one thing here reading `graph.yaml`, and best-effort — docs/shaders.md.
  const chains = (() => {
    try {
      return compileVideoChains(abs, loadGraph(abs));
    } catch {
      return { byLane: {}, frame: [] };
    }
  })();

  // Off the REF MAP and not the graph, so an unreadable `graph.yaml` cannot delete every wipe — docs/transitions.md.
  const transitions = collectTransitions(abs, tracks, loadModuleRefs(abs));

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
    transitions,
  };
}
