// renderKey.test.ts — the server's render machine: a tunnel that presents the deployment's render key
// is the one a render path reaches, a wrong key is refused outright, and a render path bound before the
// machine dialled in reaches it once it has. See docs/jobs.md.

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { TunnelHub } from "./hub.ts";
import { requestJob } from "./jobsClient.ts";
import { type AgentHandle, agentKinds } from "./testAgents.ts";

const KEY = "the-deployment-key";

const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe.each(agentKinds)("the render machine — $name agent", ({ make }) => {
  let server: Server;
  let hub: TunnelHub;
  let port: number;
  const agents: AgentHandle[] = [];

  beforeEach(async () => {
    server = createServer();
    hub = new TunnelHub({ verify: () => true, renderKey: KEY, log: () => {} });
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    for (const a of agents.splice(0)) a.stop();
    hub.stop();
    await new Promise((r) => server.close(r));
  });

  const dial = (id: string, renderKey?: string): AgentHandle => {
    const a = make({
      registryUrl: `http://127.0.0.1:${port}`,
      id,
      token: "t",
      renderKey,
      enginePort: 1,
      cacheDir: mkdtempSync(join(tmpdir(), "render-key-")),
      log: () => {},
      jobs: {
        where(req, emit) {
          emit({ type: "where", path: req.source });
        },
      },
    });
    agents.push(a);
    a.start();
    return a;
  };

  it("names the tunnel that presented the key, and no other", async () => {
    dial("laptop");
    dial("server", KEY);
    await until(() => hub.has("laptop") && hub.has("server"));
    expect(hub.renderer()).toBe("server");
  });

  it("refuses a tunnel whose key is wrong", async () => {
    dial("impostor", "not-the-key");
    dial("laptop");
    await until(() => hub.has("laptop"));
    // Given the impostor's redial time to have been refused at least once.
    await new Promise((r) => setTimeout(r, 300));
    expect(hub.has("impostor")).toBe(false);
    expect(hub.renderer()).toBeNull();
  });

  it("reaches the machine through a render path bound before it dialled in", async () => {
    const path = hub.bindRenderer([]);
    dial("server", KEY);
    await until(() => hub.renderer() === "server");
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    try {
      const reply = await requestJob(
        ws,
        { type: "where", source: "here" },
        (r) => r.type === "where",
      );
      expect(reply.path).toBe("here");
    } finally {
      ws.close();
    }
  });
});

describe("a hub with no render key", () => {
  it("has no render machine, and says so", () => {
    const hub = new TunnelHub({ verify: () => true, log: () => {} });
    expect(hub.rendersEnabled()).toBe(false);
    expect(hub.renderer()).toBeNull();
  });
});
