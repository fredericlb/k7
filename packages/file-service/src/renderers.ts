// renderers.ts — which engine bounces this service's renders: this machine's binary when it has one,
// else the bound engine's MACHINE, else the server's own render machine, both asked over a jobs path
// (packages/engine-tunnel/docs/jobs.md). A machine writes only under a writable root, so a remote render
// lands in the account's render cache first and is moved into the caller's folder. See docs/render.md.

import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { findEngineBinary } from "@studio/engine-client/engineBinary";
import { requestJobAt } from "@studio/engine-tunnel/jobs-client";
import { autoRendersHome } from "@studio/song/autoFreeze";
import {
  localRenderer,
  type Renderer,
  type RenderManifest,
} from "@studio/take-render/renderer";
import { boundJobsUrl } from "./boundMachine.ts";

/** The server's render machine, a jobs path the file hub binds when the deployment names one; unset elsewhere. */
const RENDER_JOBS_URL = process.env.STUDIO_RENDER_JOBS_URL ?? "";

/** A wedged machine is let go of after this; a song bounces in seconds, a share with stems in a minute. */
const MACHINE_RENDER_TIMEOUT_MS = 10 * 60_000;

/** A render the machine at `jobsUrl()` makes, moved into `outDir` once its files are back here. */
export function machineRenderer(jobsUrl: () => string | null): Renderer {
  return async (doc, outDir, opts = {}) => {
    // A folder on the MACHINE's disk means nothing here, and a guess would render silence.
    if (opts.base)
      throw new Error(
        "a render with a base folder needs an engine binary on this machine",
      );
    const url = jobsUrl();
    if (!url) throw new Error("no engine machine to render on");
    // Under the render cache, the one writable root every machine is given; the hub accepts no upload under a root that does not exist.
    mkdirSync(autoRendersHome(), { recursive: true });
    const staging = join(autoRendersHome(), "jobs", randomUUID());
    try {
      const reply = await requestJobAt(
        url,
        { type: "render", doc, outDir: staging, stems: !!opts.stems },
        (r) => r.type === "rendered",
        undefined,
        { totalMs: MACHINE_RENDER_TIMEOUT_MS },
      );
      return moveInto(reply, outDir);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  };
}

/** The reply's files, uploaded under the staging folder, copied into `outDir` under their own names. */
function moveInto(
  reply: Record<string, unknown>,
  outDir: string,
): RenderManifest {
  const mix = typeof reply.mix === "string" ? reply.mix : "";
  if (!mix) throw new Error("the engine's machine rendered no mixdown");
  mkdirSync(outDir, { recursive: true });
  const take = (file: string): string => {
    const name = basename(file);
    // Copied, not renamed: the render cache and a scratch folder are often on different volumes.
    copyFileSync(file, join(outDir, name));
    return name;
  };
  const stems = Array.isArray(reply.stems) ? reply.stems : [];
  return {
    mix: take(mix),
    stems: stems
      .filter(
        (s): s is { name: string; file: string } =>
          !!s && typeof s.name === "string" && typeof s.file === "string",
      )
      .map((s) => ({ name: s.name, file: take(s.file) })),
  };
}

/** This service's renderer, or null when nothing can render: the order is the header's. */
export function serviceRenderer(): Renderer | null {
  const bin = findEngineBinary();
  if (bin) return localRenderer(bin);
  const machines = [boundJobsUrl, () => RENDER_JOBS_URL || null];
  if (!machines.some((url) => url())) return null;
  return async (doc, outDir, opts) => {
    let failed: Error | null = null;
    // The next machine is tried when one fails: a bound machine may run a supervisor that predates `outDir`.
    for (const url of machines) {
      if (!url()) continue;
      try {
        return await machineRenderer(url)(doc, outDir, opts);
      } catch (e) {
        failed = e as Error;
      }
    }
    throw failed ?? new Error("no engine machine to render on");
  };
}
