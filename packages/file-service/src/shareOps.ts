// shareOps.ts — getting a project off this machine as audio: the mixdown, and the publish to k7. Two acts with one
// thing in common, and that is what makes them a module: each RENDERS first, then hands the result to somebody else.
// A share LINK renders nothing and lives in shareLink.ts.
//
// It takes a HOST of a few `Workspace` members rather than the whole class, the seam
// `projectLifecycle.ts` uses, so `safePath` and the rest do not become public API.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import {
  type K7Result,
  type Renderer,
  readK7Config,
  shareToK7,
  toMp3,
} from "@studio/take-render/render";
import { serviceRenderer } from "./renderers.ts";

/** Who renders, or a named failure: "render failed" alone reads as a broken project. */
function requireRenderer(what: string): Renderer {
  const r = serviceRenderer();
  if (!r)
    throw new Error(`no engine to render with — cannot render the ${what}`);
  return r;
}

/** What an export needs of the workspace: three members instead of a class, so `safePath` stays private. */
export interface ShareHost {
  /** The workspace root. Named in a share's origin. */
  root: string;
  /** The active project's folder, or a named exception when there is none. */
  requireActive(): string;
  /** The compiled document the engine takes, memoised by the workspace. */
  cachedProjectDoc(dir: string): ProjectDoc;
}

/** Render the mixdown; the caller streams `path` then calls `cleanup`, whether or not it worked. */
export async function exportMix(
  host: ShareHost,
  format: "wav" | "mp3",
): Promise<{
  path: string;
  filename: string;
  mime: string;
  cleanup: () => void;
}> {
  const dir = host.requireActive();
  const render = requireRenderer("mixdown");
  const doc = host.cachedProjectDoc(dir);
  const tmp = mkdtempSync(join(tmpdir(), "tbmix-"));
  const cleanup = () => {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  };
  try {
    const manifest = await render(doc, tmp);
    const wav = join(tmp, manifest.mix);
    const name = (doc.name || basename(dir) || "mixdown").replace(
      /[\\/:*?"<>|]+/g,
      "_",
    );
    if (format === "wav")
      return { path: wav, filename: `${name}.wav`, mime: "audio/wav", cleanup };
    const mp3 = join(tmp, "mix.mp3");
    if (!(await toMp3(wav, mp3)))
      throw new Error(
        "mp3 needs ffmpeg on the engine host — install ffmpeg, or use Export WAV",
      );
    return { path: mp3, filename: `${name}.mp3`, mime: "audio/mpeg", cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Publish to k7; an unknown song throws NEEDS_META, which the route turns into a prompt (docs/share.md). */
export async function shareK7(
  host: ShareHost,
  opts: { artist?: string; title?: string },
): Promise<K7Result> {
  const dir = host.requireActive();
  const render = requireRenderer("mixdown");
  const cfg = readK7Config(host.root);
  if ("error" in cfg) throw new Error(cfg.error);
  return shareToK7(render, dir, cfg, opts);
}
