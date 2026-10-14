// ampModel.ts — what an amp model FILE is: which runtime plays it and how many knobs it reacts to,
// read by the keys the engine reads (engine/k7-runtime/engine/RtNeuralModel.cpp). A panel's
// widgets.js uses it to show only the knobs a model has — engine/k7-runtime/docs/namPlugin.md.
// A `.nam` is never opened: its format has no knob inputs, so its answer is known from the name.

import { statSync } from "node:fs";
import { wsRead } from "./yaml/workspaceFile";

/** The knobs the engine's amp exposes — `Knob 1`..`Knob 3`, whatever a model declares beyond. */
export const MAX_AMP_KNOBS = 3;

export type AmpModelKind = "nam" | "aida-x" | "proteus";

/** One model as a panel sees it — @studio/graph-model's `WebChainStep.ampModel`. */
export interface AmpModelInfo {
  kind: AmpModelKind;
  /** The knob inputs past the sound, capped at MAX_AMP_KNOBS since the plugin has no more. */
  knobs: number;
}

const knobsOf = (inputs: unknown): number | undefined =>
  typeof inputs === "number" && Number.isFinite(inputs)
    ? Math.min(MAX_AMP_KNOBS, Math.max(0, Math.round(inputs) - 1))
    : undefined;

/** A parsed `.json` model — AIDA-X by `layers` + `in_shape`, Proteus by `model_data` + `state_dict` — or null. */
export function ampModelOfJson(j: unknown): AmpModelInfo | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (Array.isArray(o.layers) && Array.isArray(o.in_shape)) {
    const knobs = knobsOf(o.in_shape.at(-1));
    return knobs === undefined ? null : { kind: "aida-x", knobs };
  }
  if (o.model_data && typeof o.model_data === "object" && "state_dict" in o) {
    // The engine reads an absent `input_size` as 1: the sound alone.
    const md = o.model_data as Record<string, unknown>;
    const knobs = knobsOf(md.input_size ?? 1);
    return knobs === undefined ? null : { kind: "proteus", knobs };
  }
  return null;
}

// One parse per file VERSION: the graph is rebuilt on every edit, and a model is tens of KB of JSON.
const cache = new Map<string, { mtimeMs: number; info: AmpModelInfo | null }>();

/** The model at an ABSOLUTE path, or null when it is absent or neither format. */
export function ampModelInfo(path: string): AmpModelInfo | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".nam")) return { kind: "nam", knobs: 0 };
  if (!lower.endsWith(".json")) return null;
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.info;
  let info: AmpModelInfo | null;
  try {
    info = ampModelOfJson(JSON.parse(wsRead(path)));
  } catch {
    info = null;
  }
  cache.set(path, { mtimeMs, info });
  return info;
}
