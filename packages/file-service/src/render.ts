// render.ts — bounce a ProjectDoc to audio through this service's renderer: this machine's engine
// binary in its one-shot `--render` mode, or an engine's machine asked over a jobs path when this
// machine has none (renderers.ts). No audio device is ever opened. See docs/renderers.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { serviceRenderer } from "./renderers.ts";

/** The bound on a WEDGED bounce; a three-minute song renders in seconds. */
const RENDER_TIMEOUT_MS = 5 * 60_000;

export interface RenderResult {
  /** Absolute paths of what was written, the mixdown first. */
  files: string[];
  /** The directory holding them — the caller's to delete once it has fetched them. */
  dir: string;
}

export class RenderError extends Error {}

/** Render `doc` and return what was written — see docs/renderers.md. */
export async function renderProject(doc: unknown): Promise<RenderResult> {
  const render = serviceRenderer();
  // Named out loud, or "render failed" reads as a broken document rather than a missing engine.
  if (!render) throw new RenderError("no engine to render with");

  const dir = mkdtempSync(join(tmpdir(), "studio-render-"));
  let timer: NodeJS.Timeout | undefined;
  try {
    const manifest = await Promise.race([
      render(doc as ProjectDoc, dir).catch((e: Error) => {
        throw new RenderError(e.message);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new RenderError(`render timed out after ${RENDER_TIMEOUT_MS}ms`),
            ),
          RENDER_TIMEOUT_MS,
        );
      }),
    ]);
    const files = [manifest.mix, ...manifest.stems.map((s) => s.file)]
      .filter((f) => !!f && f.toLowerCase().endsWith(".wav"))
      .map((f) => join(dir, f));
    // Exit 0 with nothing written is a silent failure, not a successful empty render.
    if (!files.length) throw new RenderError("render wrote no audio");
    return { files, dir };
  } catch (e) {
    // The scratch directory belongs to this function until it SUCCEEDS, or a failing machine fills its temp dir.
    rmSync(dir, { recursive: true, force: true });
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
