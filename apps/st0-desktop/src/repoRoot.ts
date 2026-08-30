// repoRoot.ts — where the checkout is, for the two things that only exist unpackaged: the dev
// pidfile and the window's icon. It was hostCmd.ts's, back when this app also had to find a
// supervisor to spawn; the supervisor now runs in process (docs/supervisor.md) and this is
// what survived it.

import { statSync } from "node:fs";
import { dirname, join } from "node:path";

const isDir = (p: string): boolean => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/**
 * The monorepo root: `$STUDIO_REPO_ROOT`, else walk up until a directory holding
 * `engine/moteur` appears. Unpackaged, __dirname is inside the repo, which is what makes the
 * dev tier resolve without configuration.
 */
export function repoRoot(): string | null {
  const env = process.env.STUDIO_REPO_ROOT;
  if (env && isDir(env)) return env;
  let dir = __dirname;
  for (;;) {
    if (isDir(join(dir, "engine", "moteur"))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}
