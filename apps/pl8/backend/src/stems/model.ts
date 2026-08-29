// model.ts — which `.onnx` this service separates with. A CONFIGURED path, not a chain: the
// chain machinery exists so a musician's machine can name one of its own modules, and this
// service has no libraries checkout and no per-user modules to resolve one against.
// See ../../docs/stems.md.

import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { mediatekDir } from "@studio/mediatek/layout";

/** Beside the VOLUME rather than in a home directory: the model must outlive the container, as the songs do. */
export function modelsDir(): string {
  return process.env.STUDIO_MODELS_DIR || join(mediatekDir(), ".models");
}

/** Named, so the route can answer 503 — a server without a model is a real and fixable state. */
export class NoModelError extends Error {}

/**
 * `STUDIO_STEMS_MODEL` names one outright; otherwise the models directory must hold exactly
 * one `.onnx`. Ambiguity is REFUSED rather than guessed at: a second model separates into four
 * files that are silently the wrong four, and nothing downstream can tell.
 */
export function stemsModel(): string {
  const named = process.env.STUDIO_STEMS_MODEL;
  if (named) {
    if (!isAbsolute(named))
      throw new NoModelError("STUDIO_STEMS_MODEL must be an absolute path");
    if (!existsSync(named)) throw new NoModelError(`no model at ${named}`);
    return named;
  }
  const dir = modelsDir();
  const found = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".onnx"))
    : [];
  if (found.length === 1) return join(dir, found[0]);
  throw new NoModelError(
    found.length
      ? `${dir} holds ${found.length} models — name the one to use with STUDIO_STEMS_MODEL`
      : `no separation model on this server — put one .onnx in ${dir}, or name one with STUDIO_STEMS_MODEL`,
  );
}
