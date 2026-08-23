// render.ts — bounce a ProjectDoc to audio on THIS machine, by running the engine's
// one-shot `--render` mode. No audio device is ever opened, so this cannot collide with a
// live engine holding the interface. See docs/render.md.

import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { MP3_CODEC, transcode } from "@studio/take-render/render";

/** How long a bounce may take before it is killed. A three-minute song renders in seconds;
 *  this is the bound on a WEDGED one, which prints nothing and burns no CPU. */
const RENDER_TIMEOUT_MS = 5 * 60_000;

export interface RenderResult {
  /** Absolute paths of what was written, in the engine's own order. */
  files: string[];
  /** The directory holding them — the caller's to delete once it has fetched them. */
  dir: string;
}

export class RenderError extends Error {}

/**
 * Render `doc` and return what was written.
 *
 * The document goes in on STDIN (`--render -`), not through a temp file: it can be a
 * megabyte of clips, and a file would be one more thing to clean up on every failure path.
 *
 * `baseDir` resolves the doc's relative clip and plugin paths. A hosted caller sending
 * absolute paths — which is what the médiathèque cache produces — passes nothing.
 */
export async function renderProject(
  doc: unknown,
  opts: { baseDir?: string; stems?: boolean; mp3?: boolean } = {},
): Promise<RenderResult> {
  const bin = findEngineBinary();
  // Named out loud: a machine with no engine built is a real state, and "render failed"
  // with no reason reads as a broken document rather than a missing binary.
  if (!bin) throw new RenderError("no studio-moteur binary on this machine");

  const dir = mkdtempSync(join(tmpdir(), "studio-render-"));
  try {
    return await bounce(bin, dir, doc, opts);
  } catch (e) {
    // The scratch directory belongs to this function until it SUCCEEDS. Leaving the failure
    // paths to the caller means a machine that cannot render — no plugins, a bad document —
    // fills its temp dir one song at a time while every attempt looks like a clean error.
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/** The bounce itself, with the scratch directory already made. Split out so the cleanup
 *  above can wrap EVERY way this fails, including the ones after the process exits. */
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
    // Bounded: a render that fails on every clip could otherwise hold its whole log in
    // memory, and the first few lines are the ones that say why.
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
  // Exit 0 with nothing written is the shape a silent failure takes here — a document whose
  // every track was filtered out, say. It must not read as a successful empty render.
  if (!files.length) throw new RenderError("render wrote no audio");
  return { files: opts.mp3 ? asMp3(files) : files, dir };
}

/**
 * The same renders as mp3, where ffmpeg can manage it.
 *
 * BEST-EFFORT, which is the established rule here (see `@studio/take-render/render`, which the
 * CLI path has used for as long as it has offered formats): the engine writes wav and nothing
 * else, ffmpeg is not a dependency of this repo, and a machine without it must still be able to
 * bounce. So a failed transcode costs the FORMAT and never the render — the caller gets the wav
 * and can see what it got from the extension.
 *
 * Turning that into a hard failure would mean a render that works on one machine and 500s on
 * the next, for a reason nothing in the request could predict.
 */
function asMp3(wavs: string[]): string[] {
  return wavs.map((wav) => {
    const out = wav.replace(/\.wav$/i, ".mp3");
    return transcode(wav, out, MP3_CODEC) ? out : wav;
  });
}
