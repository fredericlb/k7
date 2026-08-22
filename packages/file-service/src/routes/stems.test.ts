// The refusals, and the one answer that costs nothing: a record already separated. A real
// separation needs a 166 MB model and an hour, so what is pinned here is everything decided
// BEFORE any of that — in particular the ORDER, since asking the disk before resolving the chain
// is what lets a set with a typo in its `stems:` line still play its prepared songs.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stemsRouter } from "./stems.ts";

/**
 * The machine's remembered chain, MOCKED.
 *
 * `loadPreferences` reads `~/.studio/preferences.yaml` — the real one, since `homedir()` does not
 * move with an env var on Windows. Left alone, "this machine separates nothing" would pass or fail
 * by whether whoever runs the suite has run `system stems`.
 */
vi.mock("@studio/song/preferences", () => ({
  loadPreferences: () => ({ stemsChain: remembered }),
}));
let remembered: string | undefined;

let cache: string;
let server: Server;
let base: string;
/** What `req.ws.activeProjectPath()` answers — set per test, `null` for "no project open". */
let projectDir: string | null;

/** A song folder in the cache, with its master. Returns the cache-relative path of the master. */
function song(name: string, stems: string[] = []): string {
  const folder = join(cache, "songs", "band", "album", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "original.wav"), "RIFF");
  if (stems.length) {
    mkdirSync(join(folder, "stems"), { recursive: true });
    for (const s of stems) writeFileSync(join(folder, "stems", s), "RIFF");
  }
  return `songs/band/album/${name}/original.wav`;
}

beforeEach(async () => {
  cache = mkdtempSync(join(tmpdir(), "stems-route-"));
  // The route resolves a cache-relative path through `safePath`, which reads this every call.
  process.env.STUDIO_MEDIATEK = cache;
  projectDir = null;
  remembered = "@st0/stems";

  const app = express();
  app.use(express.json());
  // The real server mounts this behind requireEngineToken/resolveUser/resolveWorkspace. Only
  // three of those reach the router, so three is what the stub supplies.
  app.use((req, _res, next) => {
    const r = req as {
      userEmail?: string;
      ws?: {
        activeProjectPath: () => string | null;
        cachedProjectDoc: () => unknown;
      };
    };
    r.userEmail = "fred@parapluie.org";
    r.ws = {
      activeProjectPath: () => projectDir,
      cachedProjectDoc: () => ({ tracks: [], chains: [] }),
    };
    next();
  });
  app.use(stemsRouter);
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(cache, { recursive: true, force: true });
  // `delete`, not `= undefined`: Node stores that as the STRING "undefined", and the next thing
  // to ask for the cache root would resolve a folder called that.
  delete process.env.STUDIO_MEDIATEK;
});

const post = (body: unknown) =>
  fetch(`${base}/stems`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("what POST /stems refuses before spending anything", () => {
  it("refuses a path that leaves the cache", async () => {
    const r = await post({ song: "../../etc/passwd" });
    expect(r.status).toBe(400);
  });

  it("404s a song this machine has not got", async () => {
    const r = await post({ song: "songs/nobody/here.wav" });
    expect(r.status).toBe(404);
  });

  it("409s when this machine remembers no chain, and names the verb that sets one", async () => {
    // The caller sends no chain, ever — see the route's docblock. So "which chain" is a question
    // about the MACHINE, and its unanswered state has to say where the answer goes.
    remembered = undefined;
    const rel = song("unprepared");
    const r = await post({ song: rel });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toMatch(
      /system stems/,
    );
  });

  it("409s with no project open — a chain has nothing to resolve against", async () => {
    const rel = song("unprepared");
    const r = await post({ song: rel });
    expect(r.status).toBe(409);
  });

  it("400s a chain this project does not know, with the sentence that says so", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "stems-project-"));
    remembered = "@st0/nope";
    try {
      const rel = song("unprepared");
      const r = await post({ song: rel });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(/chain/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe("a record already separated", () => {
  it("answers ready, with no job and no chain looked at at all", async () => {
    // No project open, and nothing remembered — both deliberate. The disk is asked FIRST, so a
    // machine that has never run `system stems` still lights the knobs on the songs somebody
    // prepared, and a wrong chain does not hide work that is already done.
    remembered = undefined;
    const rel = song("prepared", [
      "drums.wav",
      "bass.wav",
      "other.wav",
      "vocals.wav",
    ]);
    const r = await post({ song: rel });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ready: true, job: null });
  });

  it("is not fooled by an empty stems/ folder", async () => {
    // A separation killed halfway leaves the directory and no audio. Answering `ready` there
    // would grey nothing and subtract nothing — a deck that looks prepared and is not.
    const folder = join(cache, "songs", "band", "album", "half");
    mkdirSync(join(folder, "stems"), { recursive: true });
    writeFileSync(join(folder, "original.wav"), "RIFF");
    const r = await post({ song: "songs/band/album/half/original.wav" });
    expect(r.status).toBe(409); // fell through to the chain, which needs a project
  });
});
