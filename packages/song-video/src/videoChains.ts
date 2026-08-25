// videoChains.ts — the path graph.yaml -> the renderer: a video lane's run becomes that lane's
// plugins, and the RENDER -> VIDEO_OUT run becomes the whole frame's. Shaders
// arrive with their GLSL already read, because the browser cannot open a folder.
// Full rationale: docs/shaders.md, and docs/videoOutputs.md for the two sums.

import type { Chain, GraphDoc, Module, Step } from "@studio/song/graph";
import {
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
  let frame: VideoPluginDoc[] = [];
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
  return { byLane, frame };
}
