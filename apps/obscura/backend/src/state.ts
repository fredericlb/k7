import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Where the audio cache lives: a fresh temp directory per launch.
//
// Nothing durable is kept here. The only thing written under it is the Grist
// attachment cache (grist/load.ts) — downloaded attachments and their
// ffmpeg-transcoded copies, all of which can be re-fetched from Grist. Game
// state is NOT on disk: state/persist.ts write-behinds it to Grist's
// Games/GamePlayers tables and a fresh boot rehydrates from there.
//
// A per-launch directory means each boot starts with a cold cache and
// re-downloads + re-encodes every attachment it needs. That's the deliberate
// trade: no stale cache, no volume to manage, no cache invalidation to get
// wrong — at the cost of startup work proportional to the session's audio.
//
// This only NAMES the directory; it deliberately doesn't create it. Callers
// that write already `mkdir(..., { recursive: true })` (grist/load.ts), and
// routes.ts asks for the path just to mount a static handler — express.static
// tolerates a missing root and 404s until something populates it. Creating on
// read instead would leave an empty directory behind for every process that
// merely imports routes.ts, which is every test run.
let dir: string | null = null;

export function dataDir(): string {
  if (dir) return dir;
  // Random, not sequential: an unguessable name in a world-writable /tmp.
  dir = join(tmpdir(), `obscura-${randomUUID()}`);
  // Best-effort: the OS reaps its temp dir anyway (and a container takes the
  // whole layer with it), so a hard kill leaking one directory is acceptable.
  // force:true makes this a no-op when nothing ever wrote a cache.
  process.on("exit", () => {
    try {
      rmSync(dir!, { recursive: true, force: true });
    } catch {
      /* shutting down — nothing useful to do with the error */
    }
  });
  return dir;
}
