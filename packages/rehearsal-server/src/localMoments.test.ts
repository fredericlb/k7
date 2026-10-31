import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// A local instance: the environment is read once, at import, so it is set before the store loads.
const dir = mkdtempSync(join(tmpdir(), "k7-local-moments-"));
process.env.K7_DATA_DIR = dir;
process.env.K7_INSTANCE = "local";
const db = await import("./db.ts");
const { momentsRouter } = await import("./routes/moments.ts");
const { jsonErrors } = await import("./errors.ts");

let server: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { user?: { sub: string } }).user = { sub: "me" };
    next();
  });
  app.use("/moments", momentsRouter);
  app.use(jsonErrors);
  await new Promise<void>((ok) => {
    server = app.listen(0, () => ok());
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  await new Promise((ok) => server.close(ok));
  db.store.close();
  rmSync(dir, { recursive: true, force: true });
});

const json = (method: string, path: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("a moment on a local instance", () => {
  it("is saved with no clip, and its consolidation is refused here in words", async () => {
    const made = await json("POST", "/moments", {
      recordingPath: "recordings/2026-10-01/22-00-00.webm",
      startSec: 1,
      endSec: 3,
      text: "riff",
    });
    expect(made.status).toBe(201);
    const moment = (await made.json()) as { id: string; validated: boolean };
    expect(moment.validated).toBe(false);
    const res = await json("POST", `/moments/${moment.id}/validate`);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("server");
  });

  it("forgets a clip cut here before once its span moves, and cuts none", async () => {
    await db.addRecords("Comments", [
      {
        id: "m-old",
        OwnerId: "me",
        RecordingPath: "recordings/2026-10-01/22-00-00.webm",
        StartSec: 1,
        EndSec: 2,
        Validated: true,
        ClipPath: "recordings/2026-10-01/moment-old.webm",
      },
    ]);
    const res = await json("PUT", "/moments/m-old", { endSec: 4 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ endSec: 4, validated: false });
  });
});
