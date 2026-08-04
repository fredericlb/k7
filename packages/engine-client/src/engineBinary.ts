// engineBinary.ts — locate the built studio-moteur binary, in three tiers:
// $STUDIO_ENGINE, the copy vendored beside the running executable (a packaged app),
// then the CMake preset output dirs under engine/moteur/build, newest first. The repo
// tiers resolve relative to THIS file, so they work wherever the package is linked.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // packages/engine-client/src
// src → engine-client → packages → the repo root, then into engine/moteur/.
const engineDir = join(here, "..", "..", "..", "engine", "moteur");

export function findEngineBinary(): string | null {
  const override = process.env.STUDIO_ENGINE;
  if (override && existsSync(override)) return override;

  // Beside the running executable: in a packaged app the supervisor IS the vendored node, next to the staged
  // engine, and its import.meta.url points into Resources where the repo walk finds nothing.
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
  const found: string[] = [];
  for (const preset of readdirSync(build)) {
    for (const cfg of configs) {
      for (const name of names) {
        const p = join(build, preset, cfg, name);
        if (existsSync(p) && statSync(p).isFile()) found.push(p);
      }
    }
  }
  if (!found.length) return null;
  found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return found[0];
}
