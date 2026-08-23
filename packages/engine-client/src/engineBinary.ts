// engineBinary.ts — locate the built studio-moteur binary, in three tiers:
// $STUDIO_ENGINE, the copy vendored beside the running executable (a packaged app),
// then the CMake preset output dirs under engine/moteur/build, newest first but Debug
// last. The repo tiers resolve relative to THIS file, so they work wherever linked.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // packages/engine-client/src
// src → engine-client → packages → the repo root, then into engine/moteur/.
const engineDir = join(here, "..", "..", "..", "engine", "moteur");

export function findEngineBinary(): string | null {
  const override = process.env.STUDIO_ENGINE;
  if (override && existsSync(override)) return override;

  // Beside the running executable: in a packaged app the supervisor IS the vendored node, and the repo walk finds nothing.
  const sidecarDir = dirname(process.execPath);
  for (const name of ["studio-moteur.exe", "studio-moteur"]) {
    const p = join(sidecarDir, name);
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      /* not there — fall through to the repo build */
    }
  }

  const build = join(engineDir, "build");
  if (!existsSync(build)) return null;

  const names = ["studio-moteur.exe", "studio-moteur"];
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
