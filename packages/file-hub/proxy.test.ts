// proxy.test.ts — a client that goes away mid-download takes the hub's request to its file service
// with it, rather than leaving that socket open and paused.

import { createServer, get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Instance } from "./instances.ts";
import { pipeTo } from "./proxy.ts";

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function listen(s: Server): Promise<number> {
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return (s.address() as AddressInfo).port;
}

describe("pipeTo", () => {
  it("destroys the upstream request when the client goes away mid-body", async () => {
    const upstreamClosed = vi.fn();
    const service = createServer((req, res) => {
      req.socket.on("close", upstreamClosed);
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.write(Buffer.alloc(1024));
    });
    const port = await listen(service);
    const app = express();
    app.use((req, res) =>
      pipeTo({ port, secret: "s" } as Instance, "me", false, req, res),
    );
    const hub = await listen(createServer(app));
    await new Promise<void>((resolve) => {
      const r = get(`http://127.0.0.1:${hub}/big`, (res) => {
        res.once("data", () => {
          r.destroy();
          resolve();
        });
      });
      r.on("error", () => {});
    });
    await vi.waitFor(() => expect(upstreamClosed).toHaveBeenCalled());
  });
});
