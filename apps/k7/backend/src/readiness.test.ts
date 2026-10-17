// readiness.test.ts — `/api/ready` answers 503 for an unwritable volume or a stuck start, and 200 for a full hub.

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { describe, expect, it } from "vitest";
import {
  probeVolume,
  readinessRoute,
  STUCK_START_MS,
  volumesFromEnv,
} from "./readiness.ts";

const dir = mkdtempSync(join(tmpdir(), "ready-"));
// A plain file where a volume should be: no write can go under it.
const blocked = join(dir, "blocked");
writeFileSync(blocked, "");

const hub =
  (over: Partial<ReturnType<typeof status>> = {}) =>
  () => ({
    ...status(),
    ...over,
  });
const status = () => ({
  running: 3,
  starting: 0,
  cap: 3,
  oldestStartMs: 0,
  lastStartError: null as { at: number; message: string } | null,
});

/** Run the route once and resolve with what it answered. */
function ask(
  route: ReturnType<typeof readinessRoute>,
): Promise<{ code: number; body: { ok: boolean; problems: string[] } }> {
  return new Promise((done) => {
    let code = 200;
    const res = {
      status(c: number) {
        code = c;
        return res;
      },
      json(body: { ok: boolean; problems: string[] }) {
        done({ code, body });
      },
    };
    route({} as Request, res as unknown as Response, () => {});
  });
}

describe("readiness", () => {
  it("probes a writable volume and names an unwritable one", async () => {
    expect(await probeVolume(join(dir, "fresh"))).toBeNull();
    expect(await probeVolume(join(blocked, "under"))).toMatch(/ENOTDIR|EEXIST/);
  });

  it("is ready with a FULL hub: turning one account away is not a fault", async () => {
    const r = await ask(readinessRoute({ volumes: [dir], files: hub() }));
    expect(r.code).toBe(200);
  });

  it("is not ready with an unwritable volume or a start stuck past its timeout", async () => {
    const vol = await ask(
      readinessRoute({ volumes: [join(blocked, "x")], files: hub() }),
    );
    expect(vol.code).toBe(503);
    const stuck = await ask(
      readinessRoute({
        volumes: [dir],
        files: hub({ starting: 1, oldestStartMs: STUCK_START_MS + 1 }),
      }),
    );
    expect(stuck.code).toBe(503);
    expect(stuck.body.problems[0]).toMatch(/starting for/);
  });

  it("probes only the volumes the environment names, once each", () => {
    expect(
      volumesFromEnv({ STUDIO_FILES_ROOT: "/w", K7_DATA_DIR: "/w" }),
    ).toEqual(["/w"]);
  });
});
