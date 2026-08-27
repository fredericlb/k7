// videoChains.ts — the path graph.yaml -> the renderer: a video lane's run becomes that lane's
// plugins, and the RENDER -> VIDEO_OUT run becomes the whole frame's. Shaders
// arrive with their GLSL already read, because the browser cannot open a folder.
// Full rationale: docs/shaders.md, and docs/videoOutputs.md for the two sums.

import type { Chain, GraphDoc, Module, Step } from "@studio/song/graph";
import {
  CAMERA_IO,
  RENDER_NODE,
  SHADER_CATEGORY,
  SHADER_PARAMS,
  splitPort,
  VIDEO_OUT_NODE,
} from "@studio/song-schema/moduleTypes";
import { readShader } from "./shaders";
import type { VideoPluginDoc } from "./videoDoc";

/** Where a compiled video run lands: on the lane that starts it, or over the composited frame. */
export interface VideoChainDocs {
  /** Per video lane id, in run order. A lane with no run is simply absent. */
  byLane: Record<string, VideoPluginDoc[]>;
  /** The `RENDER -> VIDEO_OUT` run, over everything the lanes composited into. */
  frame: VideoPluginDoc[];
  /** Which CAMERA feeds each lane, by the LABEL its node names — a lane with none is absent.
   *  Empty string means "whichever camera this machine calls default" (docs/camera.md). */
  cameraByLane: Record<string, string>;
  /** …and the cameras that feed NO lane, which get a layer of their own: full frame unless the
   *  node says otherwise, in the order the graph declares them (docs/camera.md). */
  cameras: CameraLayer[];
}

/** A camera drawn as its own layer — no `video_tracks/` file behind it, and none needed. */
export interface CameraLayer {
  /** The node's name, which is the layer's id. */
  node: string;
  label: string;
  /** [x, y, w, h] in viewport px; absent is the whole frame. */
  frame?: number[];
}

/** The four knobs, clamped to 0..1 because the value leaves TypeScript for GLSL — docs/shaders.md. */
function shaderParams(module: Module | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  const authored = (module?.params ?? {}) as Record<string, unknown>;
  for (const p of SHADER_PARAMS) {
    const raw = authored[p];
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    out[p] = Math.min(1, Math.max(0, n));
  }
  return out;
}

/** The lane feeding this step's AUDIO port — a side input, and the first one only; docs/shaders.md. */
function audioSourceOf(step: Step): string | undefined {
  const first = (Array.isArray(step.in) ? step.in : [])[0];
  return first ? splitPort(String(first)).node : undefined;
}

/** One step -> one plugin doc, or null when it is no picture module — never a throw, docs/shaders.md. */
function stepDoc(
  dir: string,
  g: GraphDoc,
  owner: string,
  step: Step,
  index: number,
): VideoPluginDoc | null {
  const module = g.modules[step.module];
  if (!module) return null;
  const category = String(module.category ?? "");
  const id = `${owner}:${index}`;
  const enabled = step.enabled !== false;

  if (category === SHADER_CATEGORY) {
    // The GLSL is INLINED, and a folder that is not there compiles to a pass with no source.
    const name = typeof module.shader === "string" ? module.shader : "";
    const src = name ? readShader(dir, module, g.moduleRefs, name) : null;
    return {
      id,
      type: "shader",
      name: step.module,
      enabled,
      params: shaderParams(module),
      ...(src ? { shader: src } : {}),
      ...(audioSourceOf(step) ? { audioFrom: audioSourceOf(step) } : {}),
    };
  }
  // Not `video_transitions`: one is NAMED by a cut and never wired, so it falls through to the
  // `return null` below and `validate()` is what says so — see docs/transitions.md.
  if (category === "video_effects")
    return {
      id,
      type: "video_effect",
      name: step.module,
      enabled,
      // Numbers only: a file-valued param means nothing to a renderer — docs/shaders.md.
      params: Object.fromEntries(
        Object.entries((module.params ?? {}) as Record<string, unknown>).filter(
          (e): e is [string, number] => typeof e[1] === "number",
        ),
      ),
    };
  // Anything else on a video wire is not compiled and not reported here — docs/shaders.md.
  return null;
}

/** The steps of one run, compiled and with the bypassed ones KEPT — see docs/shaders.md. */
const runDocs = (
  dir: string,
  g: GraphDoc,
  owner: string,
  c: Chain,
): VideoPluginDoc[] =>
  c.use
    .map((s, i) => stepDoc(dir, g, owner, s, i))
    .filter((d): d is VideoPluginDoc => d !== null);

/** Every video run in the project, compiled — two shapes and one loop, see docs/shaders.md. */
export function compileVideoChains(dir: string, g: GraphDoc): VideoChainDocs {
  const byLane: Record<string, VideoPluginDoc[]> = {};
  const cameraByLane: Record<string, string> = {};
  const cameras: CameraLayer[] = [];
  let frame: VideoPluginDoc[] = [];
  // A CAMERA is a source rather than a pass: its run lands ON a picture lane, and what the lane
  // gets from it is which lens to open. The first one wins, and `validate()` reports the second.
  for (const c of Object.values(g.chains)) {
    if (c.enabled === false) continue;
    const cam = c.use.find((s) => {
      const m = g.modules[s.module];
      return m?.kind === "io" && m.io === CAMERA_IO;
    });
    if (!cam || cam.enabled === false) continue;
    const module = g.modules[cam.module];
    const label = String(module?.camera ?? "");
    let landed = false;
    for (const o of c.out) {
      const lane = splitPort(o.to).node;
      if (!g.videoTracks[lane]) continue;
      landed = true;
      if (!(lane in cameraByLane)) cameraByLane[lane] = label;
    }
    // No lane took it: the lens IS a layer, and the document authored none. See docs/camera.md.
    if (!landed && !cameras.some((x) => x.node === cam.module))
      cameras.push({
        node: cam.module,
        label,
        ...(module?.frame ? { frame: module.frame } : {}),
      });
  }
  for (const [name, c] of Object.entries(g.chains)) {
    if (c.enabled === false) continue;
    if (!c.from) continue;
    if (c.from === RENDER_NODE) {
      // Only the run that actually LEAVES for the device is the frame's chain.
      if (c.out.some((o) => splitPort(o.to).node === VIDEO_OUT_NODE))
        frame = runDocs(dir, g, RENDER_NODE, c);
      continue;
    }
    if (!g.videoTracks[c.from]) continue;
    const docs = runDocs(dir, g, c.from, c);
    if (docs.length) byLane[c.from] = docs;
  }
  return { byLane, frame, cameraByLane, cameras };
}
