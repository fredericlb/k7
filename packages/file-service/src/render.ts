// render.ts — bounce a ProjectDoc to audio on THIS machine, by running the engine's
// one-shot `--render` mode. No audio device is ever opened, so this cannot collide with a
// live engine holding the interface. See docs/render.md.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { MP3_CODEC, transcode } from "@studio/take-render/render";

/** The bound on a WEDGED bounce; a three-minute song renders in seconds. */
const RENDER_TIMEOUT_MS = 5 * 60_000;

export interface RenderResult {
  /** Absolute paths of what was written, in the engine's own order. */
  files: string[];
  /** The directory holding them — the caller's to delete once it has fetched them. */
  dir: string;
}

export class RenderError extends Error {}

/** Render `doc` and return what was written; the document goes in on STDIN — see docs/render.md. */
export async function renderProject(
  doc: unknown,
  opts: { baseDir?: string; stems?: boolean; mp3?: boolean } = {},
): Promise<RenderResult> {
  const bin = findEngineBinary();
  // Named out loud, or "render failed" reads as a broken document rather than a missing binary.
  if (!bin) throw new RenderError("no studio-moteur binary on this machine");

  const dir = mkdtempSync(join(tmpdir(), "studio-render-"));
  try {
    return await bounce(bin, dir, doc, opts);
  } catch (e) {
    // The scratch directory belongs to this function until it SUCCEEDS, or a failing machine fills its temp dir.
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** The bounce itself, split out so the cleanup above wraps EVERY way it fails, exit included. */
async function bounce(
  bin: string,
  dir: string,
  doc: unknown,
  opts: { baseDir?: string; stems?: boolean; mp3?: boolean },
): Promise<RenderResult> {
  const args = ["--render", "-", "--out", dir];
  if (opts.stems) args.push("--stems");
  if (opts.baseDir) args.push("--base", opts.baseDir);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    // Bounded, and the first lines are the ones that say why a render failed on every clip.
    child.stderr.on("data", (b) => {
      if (stderr.length < 8192) stderr += String(b);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new RenderError(`render timed out after ${RENDER_TIMEOUT_MS}ms`));
    }, RENDER_TIMEOUT_MS);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new RenderError(`could not run ${bin}: ${e.message}`));
    });
    child.on("close", (c) => {
      clearTimeout(timer);
      if (c === 0) return resolve();
      reject(new RenderError(`render exited ${c}: ${stderr.trim()}`));
    });
    child.stdin.end(JSON.stringify(doc));
  });

  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".wav"))
    .sort()
    .map((f) => join(dir, f));
  // Exit 0 with nothing written is a silent failure, not a successful empty render.
  if (!files.length) throw new RenderError("render wrote no audio");
  return { files: opts.mp3 ? asMp3(files) : files, dir };
}

/** The same renders as mp3, BEST-EFFORT: a failed transcode costs the format, never the render. */
function asMp3(wavs: string[]): string[] {
  return wavs.map((wav) => {
    const out = wav.replace(/\.wav$/i, ".mp3");
    return transcode(wav, out, MP3_CODEC) ? out : wav;
  });
}
