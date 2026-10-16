// engineLocal.test.ts — where a song is on an engine's machine, asked over a REAL tunnel: the song
// is brought there first, the answer is the MACHINE's path (never the server's), a song this volume
// does not hold is a 404, and an engine with no tunnel a 503.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EngineMount } from "@studio/engine-registry";
import { TunnelAgent } from "@studio/engine-tunnel/agent";
import { TunnelHub } from "@studio/engine-tunnel/hub";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineLocalRouter } from "./engineLocal.ts";

const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("a song's path on an engine's machine", () => {
  let server: Server;
  let hub: TunnelHub;
  let agent: TunnelAgent;
  let library: string;
  let cache: string;
  let base: string;

  beforeEach(async () => {
    library = mkdtempSync(join(tmpdir(), "local-lib-"));
    cache = mkdtempSync(join(tmpdir(), "local-cache-"));
    process.env.STUDIO_MEDIATEK = library;
    hub = new TunnelHub({ verify: () => true, log: () => {} });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { user?: { email: string } }).user = { email: "a@x.org" };
      next();
    });
    const engines = {
      registry: {
        get: (id: string) => (["e1", "e2", "e3"].includes(id) ? {} : undefined),
        // e3 is listed and nobody here holds it: a stranger's engine.
        holds: (id: string, who: string) => id !== "e3" && who === "a@x.org",
      },
      tunnels: hub,
    } as unknown as EngineMount;
    app.use("/api/engine-local", engineLocalRouter(engines));
    server = createServer(app);
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    agent = new TunnelAgent({
      registryUrl: base,
      id: "e1",
      token: "t",
      enginePort: 1,
      cacheDir: cache,
      log: () => {},
      jobs: {
        // The supervisor's own `local`, verbatim in what it does.
        local(req, emit) {
          const path = String(req.path ?? "");
          if (!existsSync(path)) throw new Error("not in the médiathèque");
          emit({ type: "local", raw: { path } });
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

  const ask = async (engineId: string, path: string) => {
    const r = await fetch(`${base}/api/engine-local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ engineId, path }),
    });
    return {
      status: r.status,
      body: (await r.json()) as { path?: string; error?: string },
    };
  };

  it("brings the song to the machine and answers with the machine's path", async () => {
    mkdirSync(join(library, "songs", "a"), { recursive: true });
    writeFileSync(join(library, "songs", "a", "original.mp3"), "SONG");
    const { status, body } = await ask("e1", "songs/a/original.mp3");
    expect(status).toBe(200);
    expect(body.path).toBe(
      join(cache, "mediatek", "songs", "a", "original.mp3"),
    );
    expect(readFileSync(body.path as string, "utf8")).toBe("SONG");
  });

  it("answers 404 for a song this volume does not hold", async () => {
    expect((await ask("e1", "songs/none.mp3")).status).toBe(404);
  });

  it("answers 503 for an engine with no tunnel, 409 for one nobody registered", async () => {
    expect((await ask("e2", "songs/a.mp3")).status).toBe(503);
    expect((await ask("zz", "songs/a.mp3")).status).toBe(409);
  });

  it("answers 403 for an engine the caller holds no claim on", async () => {
    expect((await ask("e3", "songs/a.mp3")).status).toBe(403);
  });
});
