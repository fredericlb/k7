// A model download against a real HTTP server on loopback: the bytes land under their name in the
// cache, a model already there is not fetched again, and a download that stops short leaves NOTHING
// the loader could mistake for the model. See modelDownloads.ts.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  type ModelDownload,
  modelDownload,
  startModelDownload,
} from "./modelDownloads.ts";

const MODEL = Buffer.alloc(256 * 1024, 7); // big enough to arrive in several chunks

let server: Server;
let base: string;
let hits = 0;
beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === "/model.onnx") {
      res.writeHead(200, { "content-length": String(MODEL.length) });
      res.end(MODEL);
    } else if (req.url === "/short.onnx") {
      // Announces the whole model and sends half: a connection that died mid-way.
      res.writeHead(200, { "content-length": String(MODEL.length) });
      res.write(MODEL.subarray(0, MODEL.length / 2));
      res.destroy();
    } else {
      res.writeHead(404).end("no");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

let models: string;
beforeEach(() => {
  models = mkdtempSync(join(tmpdir(), "td-models-"));
  process.env.STUDIO_MODELS = models;
  hits = 0;
});
afterEach(() => {
  delete process.env.STUDIO_MODELS;
  rmSync(models, { recursive: true, force: true });
});

/** Poll the job the way a page does, until it is done. */
async function settled(job: ModelDownload): Promise<ModelDownload> {
  for (let i = 0; i < 200; i++) {
    const now = modelDownload(job.id);
    if (now?.done) return now;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("the download never finished");
}

describe("a model download", () => {
  it("writes the model under its authored name in the cache, and counts its bytes", async () => {
    const end = await settled(
      startModelDownload("htdemucs.onnx", `${base}/model.onnx`),
    );
    expect(end.error).toBeNull();
    expect(end.received).toBe(MODEL.length);
    expect(end.total).toBe(MODEL.length);
    expect(readFileSync(join(models, "htdemucs.onnx")).equals(MODEL)).toBe(
      true,
    );
    // Renamed into place: no `.part` left for anything to trip on.
    expect(existsSync(join(models, "htdemucs.onnx.part"))).toBe(false);
  });

  it("does not fetch a model that is already on the machine", async () => {
    writeFileSync(join(models, "htdemucs.onnx"), "already here");
    const job = startModelDownload("htdemucs.onnx", `${base}/model.onnx`);
    expect(job.done).toBe(true);
    expect(job.error).toBeNull();
    expect(hits).toBe(0);
  });

  it("leaves nothing behind when the download stops short", async () => {
    // Half a model the loader would take for the model is worse than none: it would fail minutes into a separation.
    const end = await settled(
      startModelDownload("short.onnx", `${base}/short.onnx`),
    );
    expect(end.error).toMatch(/could not download short\.onnx/);
    expect(existsSync(join(models, "short.onnx"))).toBe(false);
    expect(existsSync(join(models, "short.onnx.part"))).toBe(false);
  });

  it("says what the server answered when it will not serve the file", async () => {
    const end = await settled(
      startModelDownload("gone.onnx", `${base}/gone.onnx`),
    );
    expect(end.error).toMatch(/answered 404/);
    expect(existsSync(join(models, "gone.onnx"))).toBe(false);
  });

  it("refuses a name that would land outside the cache, and fetches nothing", async () => {
    mkdirSync(join(models, "..", "escape-target"), { recursive: true });
    const job = startModelDownload("../escape.onnx", `${base}/model.onnx`);
    expect(job.done).toBe(true);
    expect(job.error).toMatch(/not a name a model can have/);
    expect(hits).toBe(0);
  });

  it("shares one job between two asks for the same file", async () => {
    const a = startModelDownload("htdemucs.onnx", `${base}/model.onnx`);
    const b = startModelDownload("htdemucs.onnx", `${base}/model.onnx`);
    expect(b.id).toBe(a.id);
    await settled(a);
    expect(hits).toBe(1);
  });
});
