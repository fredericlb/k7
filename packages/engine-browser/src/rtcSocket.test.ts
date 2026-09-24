// rtcSocket.test.ts — the browser's `rtc:` socket against the REAL tunnel hub and supervisor
// agent, node-datachannel's polyfill standing in for the browser's RTCPeerConnection. What it
// pins is that `openSocket` is a WebSocket to its callers: open, send, message, close. Skipped
// where the optional native package is not installed.

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TunnelAgent } from "@studio/engine-tunnel/agent";
import { TunnelHub } from "@studio/engine-tunnel/hub";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { openSocket } from "./rtcSocket.ts";

const available = (() => {
  try {
    createRequire(import.meta.url).resolve("node-datachannel");
    return true;
  } catch {
    return false;
  }
})();

const until = async (ok: () => boolean, ms = 8000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.skipIf(!available)("the rtc: socket", () => {
  let server: Server;
  let hub: TunnelHub;
  let agent: TunnelAgent;
  let engine: WebSocketServer;
  let base: string;

  beforeEach(async () => {
    const poly = (await import("node-datachannel/polyfill")) as unknown as {
      RTCPeerConnection: typeof RTCPeerConnection;
    };
    globalThis.RTCPeerConnection = poly.RTCPeerConnection;
    engine = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    engine.on("connection", (s) =>
      s.on("message", (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === "whoami")
          s.send(JSON.stringify({ type: "whoami", id: "e1", token: "tok" }));
      }),
    );
    await new Promise((r) => engine.once("listening", r));
    hub = new TunnelHub({ verify: () => true, log: () => {} });
    // The registry's route, reduced to what it does: hand the offer to the hub, answer its answer.
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const sdp = await hub.signal("e1", JSON.parse(body).sdp);
          res.end(JSON.stringify({ sdp }));
        } catch (e) {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
    });
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    agent = new TunnelAgent({
      registryUrl: base,
      id: "e1",
      token: "t",
      enginePort: (engine.address() as AddressInfo).port,
      cacheDir: mkdtempSync(join(tmpdir(), "rtc-sock-")),
      log: () => {},
    });
    agent.start();
    await until(() => hub.has("e1"));
  });

  afterEach(async () => {
    agent.stop();
    hub.stop();
    engine.close();
    await new Promise((r) => server.close(r));
  });

  it("opens, answers a whoami, and closes, as a WebSocket would", async () => {
    const ws = openSocket(`rtc:${base}/api/engine/e1/rtc`);
    const got: string[] = [];
    let closed = false;
    ws.onopen = () => ws.send(JSON.stringify({ type: "whoami" }));
    ws.onmessage = (ev) => got.push(String(ev.data));
    ws.onclose = () => {
      closed = true;
    };
    await until(() => got.length === 1);
    expect(JSON.parse(got[0])).toEqual({
      type: "whoami",
      id: "e1",
      token: "tok",
    });
    ws.close();
    await until(() => closed);
  });

  it("reports an error, then a close, when there is no path", async () => {
    agent.stop();
    await until(() => !hub.has("e1"));
    const ws = openSocket(`rtc:${base}/api/engine/e1/rtc`);
    const seen: string[] = [];
    ws.onerror = () => seen.push("error");
    ws.onclose = () => seen.push("close");
    await until(() => seen.length === 2);
    expect(seen).toEqual(["error", "close"]);
  });
});
