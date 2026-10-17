// readiness.ts — `/api/ready`: can this container do its job, not only answer? Each volume takes a
// write, and the file hub must have no start stuck past any timeout of its own.
// A full hub is NOT unready: it answers 503 to the account it turns away and serves the others,
// so a busy evening never flips the container unhealthy. See docs/images.md at the repo root.

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileHub } from "@studio/file-hub";
import type { RequestHandler } from "express";

/** A start waiting this long is wedged: the hub gives a child 60 s to answer before it gives up on it. */
export const STUCK_START_MS = 2 * 60_000;
/** A volume that has not taken a one-byte write in this long counts as unwritable. */
const PROBE_TIMEOUT_MS = 3_000;

/** The volumes this process writes, from the variables that name them; an unset one is not probed. */
export function volumesFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = [
    env.STUDIO_FILES_ROOT,
    env.STUDIO_MEDIATEK,
    env.K7_DATA_DIR,
    env.STUDIO_PREFS_DIR,
  ];
  return [...new Set(dirs.filter((d): d is string => !!d))];
}

/** Write and remove a file in `dir`; the error's message, or null when the volume took it. */
export async function probeVolume(
  dir: string,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<string | null> {
  const file = join(dir, `.ready-${process.pid}`);
  const write = (async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(file, "1");
    await rm(file, { force: true });
    return null;
  })().catch((e: Error) => e.message);
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<string>((res) => {
    timer = setTimeout(() => res(`no write within ${timeoutMs} ms`), timeoutMs);
  });
  try {
    return await Promise.race([write, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** 200 when every volume takes a write and no file-service start is stuck; 503 with the reasons otherwise. */
export function readinessRoute(opts: {
  volumes: string[];
  files: () => ReturnType<FileHub["status"]>;
}): RequestHandler {
  return (_req, res) => {
    void (async () => {
      const volumes: Record<string, string> = {};
      const failed = await Promise.all(opts.volumes.map((d) => probeVolume(d)));
      opts.volumes.forEach((d, i) => {
        volumes[d] = failed[i] ?? "ok";
      });
      const files = opts.files();
      const problems = opts.volumes
        .filter((_d, i) => failed[i] !== null)
        .map((d) => `${d}: ${volumes[d]}`);
      if (files.oldestStartMs > STUCK_START_MS)
        problems.push(
          `a file service has been starting for ${Math.round(files.oldestStartMs / 1000)} s`,
        );
      res
        .status(problems.length ? 503 : 200)
        .json({ ok: problems.length === 0, problems, volumes, files });
    })();
  };
}
