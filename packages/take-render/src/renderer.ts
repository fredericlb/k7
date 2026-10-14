// renderer.ts — WHO bounces a ProjectDoc: a Renderer writes the mix (and the stems) into a folder and
// answers the engine's manifest. The local one runs this machine's engine binary; a host with no
// binary hands in one that asks an engine's machine instead (packages/file-service/docs/render.md).
// A caller never spawns the engine itself, so it does not care which one it was given.

import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDoc } from "@studio/song/project";
import { wsWrite } from "@studio/song/yaml/workspaceFile";

/** The engine's render manifest: the mixdown plus, with `stems`, one wav per audible track, relative to the folder. */
export interface RenderManifest {
  mix: string;
  stems: { name: string; file: string }[];
}

/** How to bounce: per-track stems beside the mix, and the folder relative clip paths resolve under. */
export interface RenderOptions {
  stems?: boolean;
  base?: string;
}

/** Bounce `doc` into `outDir`, which exists; throws why it could not. */
export type Renderer = (
  doc: ProjectDoc,
  outDir: string,
  opts?: RenderOptions,
) => Promise<RenderManifest>;

/** The last stdout line of `--render` is its manifest. */
export function parseManifest(stdout: string): RenderManifest {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "";
  try {
    return JSON.parse(line) as RenderManifest;
  } catch {
    throw new Error(`could not read the engine's render manifest:\n${stdout}`);
  }
}

/** A wedged engine is killed after this: a song bounces in seconds, a long share with stems in minutes. */
const LOCAL_RENDER_TIMEOUT_MS = 10 * 60_000;

/** Render through a SEPARATE, short-lived engine at `engineBin` — never the one serving live playback. */
export function localRenderer(
  engineBin: string,
  timeoutMs = LOCAL_RENDER_TIMEOUT_MS,
): Renderer {
  return async (doc, outDir, opts = {}) => {
    const docFile = join(outDir, "doc.json");
    wsWrite(docFile, JSON.stringify(doc));
    const args = ["--render", docFile, "--out", outDir];
    if (opts.stems) args.push("--stems");
    if (opts.base) args.push("--base", opts.base);
    const stdout = await new Promise<string>((ok, fail) => {
      const child = spawn(engineBin, args, {
        stdio: ["ignore", "pipe", "inherit"],
      });
      let out = "";
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString("utf8");
      });
      child.on("error", (e) => {
        clearTimeout(timer);
        fail(e);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) ok(out);
        else fail(new Error(`engine render failed (exit ${code ?? "?"})`));
      });
    });
    return parseManifest(stdout);
  };
}

/** Render `doc`'s mixdown to exactly `outWav`, through a scratch folder of its own. */
export async function renderToWav(
  render: Renderer,
  doc: ProjectDoc,
  outWav: string,
): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), "st0-render-"));
  try {
    const manifest = await render(doc, tmp);
    copyFileSync(join(tmp, manifest.mix), outWav);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
