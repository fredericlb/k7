// remoteSeparation.test.ts — a hosted service's separation runs on the ENGINE'S machine: started
// and polled like a local one, answered by a supervisor over a real tunnel, its stems landing on
// the server under the paths the caller asked for. The "separation" is a stand-in that writes
// fake stems; what is pinned is the route, not the model.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TunnelAgent } from "@studio/engine-tunnel/agent";
import { TunnelHub } from "@studio/engine-tunnel/hub";
import type { SeparateJob } from "@studio/web-protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { remoteSeparationRunner } from "./remoteSeparation.ts";

const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("a hosted separation", () => {
  let server: Server;
  let hub: TunnelHub;
  let agent: TunnelAgent;
  let ws: string;
  let models: string;
  let port: number;

  beforeEach(async () => {
    ws = mkdtempSync(join(tmpdir(), "rs-ws-"));
    models = mkdtempSync(join(tmpdir(), "rs-models-"));
    server = createServer();
    hub = new TunnelHub({ verify: () => true, log: () => {} });
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
    agent = new TunnelAgent({
      registryUrl: `http://127.0.0.1:${port}`,
      id: "e1",
      token: "t",
      enginePort: 1,
      cacheDir: mkdtempSync(join(tmpdir(), "rs-cache-")),
      log: () => {},
      jobs: {
        // Stands in for the model: both inputs must be HERE, and each output is written locally.
        separate(req, emit) {
          const mix = readFileSync(String(req.source), "utf8");
          const model = readFileSync(String(req.model), "utf8");
          const outDir = String(req.outDir);
          mkdirSync(outDir, { recursive: true });
          const files = (req.outputs as string[]).map((o) => {
            const f = join(outDir, `${o}.wav`);
            writeFileSync(f, `${o} of ${mix} by ${model}`);
            return f;
          });
          const job = {
            id: "machine-side",
            source: String(req.source),
            done: true,
            failed: false,
            error: null,
            phase: "done",
            percent: 100,
            lines: [],
            files,
          };
          emit({ type: "separated", job });
        },
      },
    });
    agent.start();
    await until(() => hub.has("e1"));
  });

  afterEach(async () => {
    agent.stop();
    hub.stop();
    await new Promise((r) => server.close(r));
  });

  const roots = () => [
    { remote: ws, name: "ws-a", writable: true },
    { remote: models, name: "models-a", writable: false },
  ];

  it("runs on the bound engine's machine and lands its stems on the server", async () => {
    writeFileSync(join(ws, "mix.wav"), "MIX");
    writeFileSync(join(models, "demucs.onnx"), "MODEL");
    const jobsUrl = `ws://127.0.0.1:${port}${hub.bindLocal("e1", roots(), "jobs")}`;
    const runner = remoteSeparationRunner(() => jobsUrl);
    const started = runner.start({
      userEmail: "a@x.org",
      source: `${ws}/mix.wav`,
      model: `${models}/demucs.onnx`,
      outputs: ["vocals", "drums"],
      outDir: `${ws}/stems`,
    });
    let job: SeparateJob | null = started;
    await until(() => {
      job = runner.job(started.id);
      return !!job?.done;
    });
    expect(job).toMatchObject({
      id: started.id,
      failed: false,
      files: [`${ws}/stems/vocals.wav`, `${ws}/stems/drums.wav`],
    });
    expect(readFileSync(join(ws, "stems", "vocals.wav"), "utf8")).toBe(
      "vocals of MIX by MODEL",
    );
  });

  it("fails at once, and says why, with no engine bound", () => {
    const runner = remoteSeparationRunner(() => null);
    const job = runner.start({
      userEmail: "a@x.org",
      source: "/x.wav",
      model: "/m.onnx",
      outDir: "/out",
    });
    expect(job).toMatchObject({ done: true, failed: true });
    expect(job.error).toMatch(/no engine/);
  });
});
