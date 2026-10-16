// livePath.ts — a path another replica named, as an absolute path that cannot leave the folder it is under.
// The relay already refuses such a path; this check is the writer's own, since a server can be the attacker. See docs/liveCapture.md.

import { resolve } from "node:path";
import { assertSyncPath } from "@studio/live-sync/path";
import { isBelow } from "@studio/web-protocol/paths";

/** `rel` (workspace-relative, POSIX) under `root`; throws when it is not a sync path or resolves outside `root`. */
export function confinedPath(root: string, rel: string): string {
  assertSyncPath(rel);
  const base = resolve(root);
  const abs = resolve(base, ...rel.split("/"));
  if (!isBelow(base, abs))
    throw new Error(
      `refused sync path ${JSON.stringify(rel)}: outside ${base}`,
    );
  return abs;
}
