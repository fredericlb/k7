// rtc.test.ts — the WebRTC path end to end, with node-datachannel's own RTCPeerConnection
// standing in for the browser: the offer crosses the tunnel, the supervisor answers, and frames
// larger than one fragment reach the engine and come back whole. Skipped where the optional
// native package is not installed.

import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FragmentJoiner, toFragments } from "@studio/web-protocol/rtc-frames";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { TunnelAgent } from "./agent.ts";
import { TunnelHub } from "./hub.ts";

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

describe.skipIf(!available)("the WebRTC path", () => {
  let server: Server;
  let hub: TunnelHub;
  let agent: TunnelAgent;
  let engine: WebSocketServer;
  let engineGot: string[];

  beforeEach(async () => {
    engineGot = [];
    engine = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    engine.on("connection", (s) =>
      s.on("message", (d) => {
        engineGot.push(d.toString());
        s.send(JSON.stringify({ type: "echo", size: d.toString().length }));
      }),
    );
    await new Promise((r) => engine.once("listening", r));
    server = createServer();
    hub = new TunnelHub({ verify: () => true, log: () => {} });
    hub.attach(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    agent = new TunnelAgent({
      registryUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      id: "e1",
      token: "t",
      enginePort: (engine.address() as AddressInfo).port,
      cacheDir: mkdtempSync(join(tmpdir(), "rtc-cache-")),
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

  it("carries a frame larger than a fragment to the engine and back", async () => {
    const { RTCPeerConnection } = (await import(
      "node-datachannel/polyfill"
    )) as unknown as {
      RTCPeerConnection: typeof globalThis.RTCPeerConnection;
    };
    const pc = new RTCPeerConnection({ iceServers: [] });
    const dc = pc.createDataChannel("engine");
    dc.binaryType = "arraybuffer";
    const joiner = new FragmentJoiner();
    const back: string[] = [];
    dc.onmessage = (ev) => {
      const f = joiner.push(new Uint8Array(ev.data as ArrayBuffer));
      if (f && "text" in f) back.push(f.text);
    };
    await pc.setLocalDescription(await pc.createOffer());
    await until(() => pc.iceGatheringState === "complete", 3000).catch(
      () => {},
    );
    const answer = await hub.signal("e1", pc.localDescription?.sdp ?? "");
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    await until(() => dc.readyState === "open");
    const big = JSON.stringify({ type: "project", doc: "x".repeat(60_000) });
    for (const f of toFragments(big)) dc.send(f);
    await until(() => engineGot.length === 1 && back.length === 1);
    expect(engineGot[0]).toBe(big);
    expect(JSON.parse(back[0])).toEqual({ type: "echo", size: big.length });
    pc.close();
  });

  it("refuses an offer for an engine with no tunnel", async () => {
    await expect(hub.signal("nobody", "v=0")).rejects.toThrow(/no tunnel/);
  });
});
