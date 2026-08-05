// The refusals. A separation itself needs a 166 MB model and an hour, so what is pinned here
// is everything that happens BEFORE any of that is spent — and the distinction the route makes
// between "you asked wrong" and "this machine cannot", which is the difference between a 400
// and a 503 and is the whole reason a missing model is not reported as a failed separation.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { separateRouter } from "./separate.ts";

let dir: string;
let server: Server;
let base: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "separate-"));
  const app = express();
  app.use(express.json());
  // The real server mounts this behind requireEngineToken/resolveUser; the router itself only
  // ever reads `req.userEmail`, so a stub is enough to exercise its own decisions.
  app.use((req, _res, next) => {
    (req as { userEmail?: string }).userEmail = "fred@parapluie.org";
    next();
  });
  app.use(separateRouter);
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  fetch(`${base}/separate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("what /separate refuses before spending anything", () => {
  it("wants absolute paths, because it has no workspace to resolve against", () => {
    // This router is mounted BEFORE resolveWorkspace — a relative path here would have nothing
    // to be relative TO, so it is refused rather than guessed at.
    return Promise.all([
      post({ source: "songs/x.wav", model: "/m.onnx" }).then((r) =>
        expect(r.status).toBe(400),
      ),
      post({ source: "/x.wav", model: "htdemucs.onnx" }).then((r) =>
        expect(r.status).toBe(400),
      ),
    ]);
  });

  it("404s a source that is not there", async () => {
    const model = join(dir, "m.onnx");
    writeFileSync(model, "weights");
    const r = await post({ source: join(dir, "nope.wav"), model });
    expect(r.status).toBe(404);
  });

  it("503s a missing MODEL, and says where to put one", async () => {
    // Not a 404 and not a 500. A machine without the model is a real, fixable state — the same
    // shape as "no engine on this machine" — and reporting it as a failed separation would
    // send the reader looking at their audio file.
    const source = join(dir, "mix.wav");
    writeFileSync(source, "riff");
    const r = await post({ source, model: join(dir, "absent.onnx") });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/models/);
  });
});

describe("what /separate/:id says about a job it never had", () => {
  it("404s rather than inventing a finished one", async () => {
    // cloneJobs' rule: a job this service has forgotten cannot be waited on, and the caller's
    // real question — are the stems on disk? — is one it can ask the disk.
    const r = await fetch(`${base}/separate/deadbeefdeadbeef`);
    expect(r.status).toBe(404);
  });
});
