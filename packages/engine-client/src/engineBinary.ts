// engineBinary.ts — locate the built st0-engine binary, in three tiers:
// $STUDIO_ENGINE, the copy vendored beside the bundle (a packaged app), then the CMake
// preset output dirs under engine/moteur/build, newest first but Debug last. The repo tier
// resolves relative to THIS file, so it works wherever linked — see docs/engineBinary.md.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `packages/engine-client/src`, or null once this file has been bundled to CJS — `import.meta`
 * is empty there, and reading it must not throw at module load. The repo tier it feeds is a
 * DEV convenience; a packaged app answers from `sidecar` before ever reaching it.
 */
function sourceDir(): string | null {
  const url: string | undefined = import.meta.url;
  if (!url) return null;
  try {
    return dirname(fileURLToPath(url));
  } catch {
    return null;
  }
}

/**
 * `sidecar` is where the bundle was staged and `repo` is the checkout, both for a caller that
 * knows. Without them the probes are `process.execPath` and this file's own path, which are
 * right only while the asker IS the vendored node running from source — an app that embeds
 * the supervisor is neither, and must say, or it finds no engine at all.
 */
export function findEngineBinary(
  sidecar?: string | null,
  repo?: string | null,
): string | null {
  const override = process.env.STUDIO_ENGINE;
  if (override && existsSync(override)) return override;

  for (const dir of [sidecar, dirname(process.execPath)]) {
    if (!dir) continue;
    for (const name of ["st0-engine.exe", "st0-engine"]) {
      const p = join(dir, name);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        /* not there — try the next candidate, then the repo build */
      }
    }
  }

  // src → engine-client → packages → the repo root; `repo` is for a caller that was BUNDLED,
  // where this file's own path is gone and the walk has nothing to start from.
  const here = sourceDir();
  const root = repo ?? (here ? join(here, "..", "..", "..") : null);
  if (!root) return null;
  const build = join(root, "engine", "moteur", "build");
  if (!existsSync(build)) return null;

  const names = ["st0-engine.exe", "st0-engine"];
  const configs = ["", "Release", "RelWithDebInfo", "Debug"];
  const found: { path: string; debug: boolean }[] = [];
  for (const preset of readdirSync(build)) {
    for (const cfg of configs) {
      for (const name of names) {
        const p = join(build, preset, cfg, name);
        if (existsSync(p) && statSync(p).isFile())
          found.push({ path: p, debug: cfg === "Debug" });
      }
    }
  }
  if (!found.length) return null;
  // Newest first WITHIN a tier, Debug being a tier of its own below every other: at -O0 the DSP path cannot render in real time.
  found.sort(
    (a, b) =>
      Number(a.debug) - Number(b.debug) ||
      statSync(b.path).mtimeMs - statSync(a.path).mtimeMs,
  );
  return found[0].path;
}
