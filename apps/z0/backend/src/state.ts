import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A fresh temp dir per launch, only NAMED and never created — see ../../docs/origin.md.
let dir: string | null = null;

export function dataDir(): string {
  if (dir) return dir;
  // Random, not sequential: an unguessable name in a world-writable /tmp.
  dir = join(tmpdir(), `z0-${randomUUID()}`);
  // Best-effort, and force:true makes it a no-op when nothing ever wrote a cache.
  process.on("exit", () => {
    try {
      rmSync(dir!, { recursive: true, force: true });
    } catch {
      /* shutting down — nothing useful to do with the error */
    }
  });
  return dir;
}
