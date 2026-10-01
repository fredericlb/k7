// modelCache.ts — where the machine keeps the neural models a module names but does not
// carry. The same state-dir reasoning as mediatekRoot.ts: engine-client imports song and
// never the reverse, so a path song itself needs is defined here.
// Why a module's model may live outside its folder: docs/moduleAssets.md.

import { isAbsolute, join, resolve, sep } from "node:path";
import { FILE_PARAMS, type FileParam } from "@studio/song-schema/moduleTypes";
import { studioHome } from "./studioHome";

/** `<state>/models` or `$STUDIO_MODELS`, resolved for the reason `mediatekRoot` is: one spelling. */
export function modelsRoot(): string {
  return resolve(process.env.STUDIO_MODELS || join(studioHome(), "models"));
}

/** A model a module names and this machine has not got: the file as authored, and where it downloads from if the module says. */
export interface MissingModel {
  file: string;
  /** The module's `model_url`; absent when it gives none, and then nothing here can fetch it. */
  url?: string;
}

/**
 * The model a RESOLVED module names (`onnx:` or `model:`) that resolved to nothing — neither its own
 * `assets/` nor the machine's cache holds it — or null when it names none or has it. The loader has
 * already tried both places, so an authored name with no resolved path is exactly "not here".
 */
export function missingModel(
  m: {
    assets?: Record<string, string>;
    model_url?: unknown;
  } & Partial<Record<FileParam, unknown>>,
): MissingModel | null {
  for (const field of FILE_PARAMS) {
    const file = m.assets?.[field];
    if (!file || m[field]) continue;
    const url =
      typeof m.model_url === "string" && m.model_url ? m.model_url : undefined;
    return url ? { file, url } : { file };
  }
  return null;
}

/** Where a model named `file` lands in the cache — null for a name that would leave it, which is refused rather than cleaned. */
export function modelCachePath(file: string): string | null {
  if (!file || isAbsolute(file)) return null;
  const root = modelsRoot();
  const at = resolve(root, file);
  return at.startsWith(root + sep) ? at : null;
}
