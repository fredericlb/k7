// videoChains.ts — the path graph.yaml -> the renderer, which did not exist: a video lane's run
// becomes that lane's plugins, and the RENDER -> VIDEO_OUT run becomes the whole frame's. Shaders
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

/**
 * The four knobs, read off the module and clamped to the range the panel offers.
 *
 * Clamped rather than passed through, and the reason is that the value leaves TypeScript for
 * GLSL: a `P1: 4` authored by hand reaches a shader that has every right to assume 0..1, and what
 * comes out is not a wrong picture but an unrecognisable one. Refusing the project over it would
 * be worse — it is one knob — so the value is brought into range where the range is known.
 *
 * A param the module never mentions is 0. Not absent: the uniform exists in the program whatever
 * the file says, and leaving it unset would hand the shader whatever GL last had there.
 */
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

/**
 * The lane feeding this step's AUDIO port, if anything does.
 *
 * A shader's audio input is a side input, so it is never the chain flow: it arrives as one of the
 * step's `in:` sources, which is what `gtr: [ glow#audio ]` compiles to. The NODE is what comes
 * back and the port is dropped — what the renderer needs is a name to look a level up by, and
 * which jack it landed on is already settled by having reached this port at all.
 *
 * The first one only. A step's sources fill its ports in order and a shader declares exactly one
 * audio port, so a second source is a wiring mistake the port check already reports; picking the
 * first here means this function does not report it a second time in a different vocabulary.
 */
function audioSourceOf(step: Step): string | undefined {
  const first = (Array.isArray(step.in) ? step.in : [])[0];
  return first ? splitPort(String(first)).node : undefined;
}

/**
 * One step -> one plugin doc, or null when the module behind it is not a picture module at all.
 *
 * Null rather than a throw for a module that IS missing: `validate()` already reports that, by
 * name, on the line that names it. Compiling the picture is not the place a broken reference is
 * discovered, and throwing here would take the whole frame down over one step.
 */
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
    // The GLSL is INLINED rather than served behind a URL, and that is a size judgement rather
    // than a principle: a shader is a page of text, the video doc is already revision-keyed and
    // cached, and a second route would mean the picture could draw before its programs arrived.
    //
    // A `shader:` naming a folder that is not there compiles to a pass with no source — see
    // readShader on why that is null and not an error. The node keeps its card, its knobs and its
    // dropdown; what it loses is the effect.
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
  if (category === "video_effects" || category === "video_transitions")
    return {
      id,
      type: category === "video_effects" ? "video_effect" : "video_transition",
      name: step.module,
      enabled,
      // Numbers only: `params:` may hold a file-valued string, and none of those means anything
      // to a renderer. The same lift `nodeProject` does before the audio wire.
      params: Object.fromEntries(
        Object.entries((module.params ?? {}) as Record<string, unknown>).filter(
          (e): e is [string, number] => typeof e[1] === "number",
        ),
      ),
    };
  // Anything else on a video wire — an audio effect somebody dragged in — is not compiled and not
  // reported here either: the port check refuses picture into an audio module already, and it
  // says so about the wire rather than about a frame that failed to draw.
  return null;
}

/** The steps of one run, compiled and with the bypassed ones kept: the renderer needs to DRAW a
 *  bypassed pass as off rather than be handed a shorter list it cannot tell from a shorter chain. */
const runDocs = (
  dir: string,
  g: GraphDoc,
  owner: string,
  c: Chain,
): VideoPluginDoc[] =>
  c.use
    .map((s, i) => stepDoc(dir, g, owner, s, i))
    .filter((d): d is VideoPluginDoc => d !== null);

/**
 * Every video run in the project, compiled.
 *
 * Two shapes and one loop, which is the answer to "where may a shader go": a run out of a video
 * LANE shades that layer before it is composited, and the run out of `RENDER` shades the frame
 * they were composited into. Neither is a special case of the other and both are ordinary chains
 * — the only thing that differs is where the result is filed. See docs/videoOutputs.md.
 *
 * A whole-chain bypass (`enabled: false` on the run) drops it entirely rather than marking every
 * step off: the run is what was switched out, and a list of disabled passes would draw as a stack
 * of controls for something that is not there.
 */
export function compileVideoChains(dir: string, g: GraphDoc): VideoChainDocs {
  const byLane: Record<string, VideoPluginDoc[]> = {};
  let frame: VideoPluginDoc[] = [];
  for (const [name, c] of Object.entries(g.chains)) {
    if (c.enabled === false) continue;
    if (!c.from) continue;
    if (c.from === RENDER_NODE) {
      // Only the run that actually LEAVES for the device. A run out of the sum that ends
      // somewhere else is not the frame's chain, and treating it as one would apply a pass the
      // picture never reaches.
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
