// cut.test.ts — a library cut over a REAL tunnel: the account's chain names the model, the chosen
// engine's machine runs a stand-in separation on its local copies, and the stems land in the
// song's own `stems/` on this volume. What is pinned is the route, not the model.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TunnelAgent } from "@studio/engine-tunnel/agent";
import { TunnelHub } from "@studio/engine-tunnel/hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CutDeps, CutError, cutStems } from "./cut.ts";

const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("a library cut", () => {
  let server: Server;
  let hub: TunnelHub;
  let agent: TunnelAgent;
  let library: string;
  let models: string;
  let deps: CutDeps;

  beforeEach(async () => {
    library = mkdtempSync(join(tmpdir(), "cut-lib-"));
    models = mkdtempSync(join(tmpdir(), "cut-models-"));
    process.env.STUDIO_MEDIATEK = library;
    server = createServer();
    hub = new TunnelHub({ verify: () => true, log: () => {} });
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    agent = new TunnelAgent({
      registryUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      id: "e1",
      token: "t",
      enginePort: 1,
      cacheDir: mkdtempSync(join(tmpdir(), "cut-cache-")),
      log: () => {},
      jobs: {
        separate(req, emit) {
          const mix = readFileSync(String(req.source), "utf8");
          const model = readFileSync(String(req.model), "utf8");
          mkdirSync(String(req.outDir), { recursive: true });
          const files = (req.outputs as string[]).map((o) => {
            const f = join(String(req.outDir), `${o}.wav`);
            writeFileSync(f, `${o}:${mix}:${model}`);
            return f;
          });
          emit({
            type: "separating",
            job: { done: false, phase: "separating", percent: 50 },
          });
          emit({
            type: "separated",
            job: { done: true, failed: false, error: null, files },
          });
        },
      },
    });
    agent.start();
    await until(() => hub.has("e1"));
    deps = {
      coldRun: async () => ({
        model: join(models, "demucs.onnx"),
        outputs: ["vocals", "drums", "bass", "other"],
        roots: [
          { remote: library, name: "mediatek", writable: true },
          { remote: models, name: "models-a", writable: false },
        ],
      }),
      jobsChannel: (id, roots) => hub.openReady(id, roots, 5000, "jobs"),
    };
  });

  afterEach(async () => {
    agent.stop();
    hub.stop();
    await new Promise((r) => server.close(r));
  });

  it("runs on the engine's machine and lands the stems beside the song", async () => {
    mkdirSync(join(library, "songs", "a"), { recursive: true });
    writeFileSync(join(library, "songs", "a", "master.flac"), "MIX");
    writeFileSync(join(models, "demucs.onnx"), "MODEL");
    const phases: string[] = [];
    const done = await cutStems({
      deps,
      engineId: "e1",
      userEmail: "a@x.org",
      song: "songs/a/master.flac",
      chain: "",
      onProgress: (j) => phases.push(j.phase),
    });
    expect(phases).toEqual(["separating", undefined]);
    expect(done.files).toEqual([
      "vocals.wav",
      "drums.wav",
      "bass.wav",
      "other.wav",
    ]);
    expect(
      readFileSync(join(library, "songs", "a", "stems", "vocals.wav"), "utf8"),
    ).toBe("vocals:MIX:MODEL");
  });

  it("refuses an engine with no tunnel, by name", async () => {
    writeFileSync(join(library, "b.flac"), "B");
    await expect(
      cutStems({
        deps,
        engineId: "nobody",
        userEmail: "a@x.org",
        song: "b.flac",
        chain: "",
      }),
    ).rejects.toThrow(CutError);
  });
});
