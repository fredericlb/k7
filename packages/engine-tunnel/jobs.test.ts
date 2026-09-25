// jobs.test.ts — a jobs channel end to end: the agent answers the request ITSELF, the file it
// names is on the machine before the handler runs, and a file the handler writes is on the
// server before the reply naming it arrives. The handler here stands in for a separation.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { TunnelHub } from "./hub.ts";
import { JobError, requestJob } from "./jobsClient.ts";
import { type AgentHandle, agentKinds } from "./testAgents.ts";

const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe.each(agentKinds)("a jobs channel — $name agent", ({ make }) => {
  let server: Server;
  let hub: TunnelHub;
  let agent: AgentHandle;
  let remote: string;
  let port: number;
  let cache: string;

  beforeEach(async () => {
    remote = mkdtempSync(join(tmpdir(), "jobs-remote-"));
    cache = mkdtempSync(join(tmpdir(), "jobs-cache-"));
    server = createServer();
    hub = new TunnelHub({ verify: () => true, log: () => {} });
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
    agent = make({
      registryUrl: `http://127.0.0.1:${port}`,
      id: "e1",
      token: "t",
      enginePort: 1, // no engine at all: a jobs channel never dials one
      cacheDir: cache,
      log: () => {},
      jobs: {
        // Reads the source it was handed, writes one "stem" beside it, reporting progress first.
        // Answers the same path twice: once as the server's, once under `raw` as the machine's.
        where(req, emit) {
          emit({ type: "where", path: req.source, raw: { path: req.source } });
        },
        async upper(req, emit) {
          const text = readFileSync(String(req.source), "utf8");
          emit({ type: "progress", percent: 50 });
          mkdirSync(String(req.outDir), { recursive: true });
          const out = join(
            String(req.outDir),
            `${basename(String(req.source))}.up`,
          );
          writeFileSync(out, text.toUpperCase());
          emit({ type: "done", files: [out] });
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

  const roots = () => [{ remote, name: "lib", writable: true }];

  it("runs the request on the machine and brings its output back", async () => {
    writeFileSync(join(remote, "song.txt"), "la la");
    const ch = await hub.openReady("e1", roots(), 5000, "jobs");
    if (!ch) throw new Error("no channel");
    const seen: string[] = [];
    const reply = await requestJob(
      ch,
      {
        type: "upper",
        source: `${remote}/song.txt`,
        outDir: `${remote}/stems`,
      },
      (r) => r.type === "done",
      (r) => seen.push(r.type),
    );
    expect(seen).toEqual(["progress", "done"]);
    expect(reply.files).toEqual([`${remote}/stems/song.txt.up`]);
    expect(readFileSync(join(remote, "stems", "song.txt.up"), "utf8")).toBe(
      "LA LA",
    );
  });

  it("delivers a reply's `raw` as the machine wrote it, and maps the rest", async () => {
    writeFileSync(join(remote, "w.txt"), "w");
    const ch = await hub.openReady("e1", roots(), 5000, "jobs");
    if (!ch) throw new Error("no channel");
    const reply = await requestJob(
      ch,
      { type: "where", source: `${remote}/w.txt` },
      (r) => r.type === "where",
    );
    expect(reply.path).toBe(`${remote}/w.txt`);
    const local = (reply.raw as { path: string }).path;
    expect(local).toBe(join(cache, "lib", "w.txt"));
    expect(readFileSync(local, "utf8")).toBe("w");
  });

  it("says so when the machine does not do what was asked", async () => {
    const ch = await hub.openReady("e1", roots(), 5000, "jobs");
    if (!ch) throw new Error("no channel");
    await expect(requestJob(ch, { type: "nope" }, () => true)).rejects.toThrow(
      JobError,
    );
  });

  it("is reachable from a bound loopback path, as a hosted file service reaches it", async () => {
    writeFileSync(join(remote, "b.txt"), "b");
    const path = hub.bindLocal("e1", roots(), "jobs");
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    const reply = await requestJob(
      ws,
      { type: "upper", source: `${remote}/b.txt`, outDir: `${remote}/out` },
      (r) => r.type === "done",
    );
    expect(reply.files).toEqual([`${remote}/out/b.txt.up`]);
    ws.close();
  });
});
