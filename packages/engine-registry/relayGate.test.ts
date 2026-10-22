// relayGate.test.ts — a relay ticket is an account's, and it drives nothing until that account
// holds a claim: before it, the probe passes and everything else waits, then closes. Also the
// WebRTC offer, which reaches the engine's machine directly and so asks for the claim up front,
// and the engine token, which reaches through the relay only an account that may use the engine.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { createBindings } from "./bindings.ts";
import {
  attachEngineProxy,
  hostsFor,
  issueEngineTicket,
  verifyEngineTicket,
} from "./proxy.ts";
import { createRegistry, type EngineRegistry } from "./registry.ts";
import { type Frame, NO_CLAIM_CLOSE, RelayGate } from "./relayGate.ts";
import { engineRegistryRouter } from "./router.ts";

const text = (m: object): Frame => ({
  data: Buffer.from(JSON.stringify(m)),
  binary: false,
});

describe("the relay ticket", () => {
  it("names the account it was minted for, and a tampered one is nothing", () => {
    const t = issueEngineTicket("e1", "alice@x");
    expect(verifyEngineTicket(t)).toEqual({ id: "e1", holder: "alice@x" });
    const [payload, sig] = t.split(".");
    const forged = Buffer.from(
      JSON.stringify({ id: "e1", h: "bob@x", exp: Date.now() + 60_000 }),
    ).toString("base64url");
    expect(verifyEngineTicket(`${forged}.${sig}`)).toBeNull();
    expect(verifyEngineTicket(`${payload}.x${sig}`)).toBeNull();
  });
});

describe("where the server dials an engine", () => {
  it("is the heartbeat's own source address, never one it names", () => {
    expect(hostsFor({ publicIpHint: "::ffff:192.168.1.9" })).toEqual([
      "192.168.1.9",
    ]);
    expect(hostsFor({ publicIpHint: "127.0.0.1" })).toEqual(["127.0.0.1"]);
    expect(hostsFor({ publicIpHint: "::1" })).toEqual(["127.0.0.1"]);
    expect(hostsFor({ publicIpHint: "2001:db8::1" })).toEqual([]);
    expect(hostsFor({})).toEqual([]);
  });
});

const passes = (f: Frame | null): boolean => f !== null;

describe("the gate", () => {
  let holds: boolean;
  let mayRead: boolean;
  let sent: string[];
  let closed: [number, string] | null;
  let gate: RelayGate;
  beforeEach(() => {
    vi.useFakeTimers();
    holds = false;
    mayRead = true;
    sent = [];
    closed = null;
    gate = new RelayGate(
      {
        holds: () => holds,
        mayReadToken: () => mayRead,
        toEngine: (f) => sent.push(String(f.data)),
        close: (code, reason) => {
          closed = [code, reason];
        },
      },
      1000,
    );
  });
  afterEach(() => {
    gate.dispose();
    vi.useRealTimers();
  });

  it("passes the probe and its answers before any claim, and nothing else", () => {
    gate.fromClient(text({ type: "pair", key: "k" }));
    gate.fromClient(text({ type: "whoami" }));
    gate.fromClient(text({ type: "list-plugins" }));
    gate.fromClient(text({ type: "plugin-scan" }));
    expect(sent).toHaveLength(4);
    expect(
      passes(gate.fromEngine(text({ type: "plugin-scan", scanning: true }))),
    ).toBe(true);
    expect(passes(gate.fromEngine(text({ type: "whoami", id: "e1" })))).toBe(
      true,
    );
    expect(
      passes(gate.fromEngine(text({ type: "plugins", plugins: [] }))),
    ).toBe(true);
    expect(
      passes(gate.fromEngine(text({ type: "state", playing: true }))),
    ).toBe(false);
    expect(
      passes(gate.fromEngine({ data: Buffer.from([1, 2]), binary: true })),
    ).toBe(false);
  });

  it("strips the token from a whoami for an account that may not use the engine", () => {
    const who = text({
      type: "whoami",
      id: "e1",
      token: "tok",
      bufferSize: 64,
    });
    expect(JSON.parse(String(gate.fromEngine(who)?.data)).token).toBe("tok");
    mayRead = false;
    const out = JSON.parse(String(gate.fromEngine(who)?.data));
    expect(out).toEqual({ type: "whoami", id: "e1", bufferSize: 64 });
    holds = true;
    expect(
      JSON.parse(String(gate.fromEngine(who)?.data)).token,
    ).toBeUndefined();
  });

  it("holds what comes next, in order, and lets it through once the claim lands", () => {
    gate.fromClient(text({ type: "hello", role: "driver" }));
    gate.fromClient(text({ type: "whoami" }));
    expect(sent).toEqual([]);
    holds = true;
    vi.advanceTimersByTime(250);
    expect(sent.map((s) => JSON.parse(s).type)).toEqual(["hello", "whoami"]);
    expect(passes(gate.fromEngine(text({ type: "state" })))).toBe(true);
    expect(closed).toBeNull();
  });

  it("closes the socket when no claim comes", () => {
    gate.fromClient(text({ type: "transport", action: "play" }));
    vi.advanceTimersByTime(1200);
    expect(sent).toEqual([]);
    expect(closed?.[0]).toBe(NO_CLAIM_CLOSE);
  });

  it("stops a holder that lost its claim at its next frame", () => {
    holds = true;
    gate.fromClient(text({ type: "transport", action: "play" }));
    holds = false;
    gate.fromClient(text({ type: "transport", action: "stop" }));
    expect(sent).toHaveLength(1);
  });
});

describe("the relay, end to end", () => {
  let reg: EngineRegistry;
  let server: Server;
  let engine: WebSocketServer;
  let port: number;
  /** What the fake engine received after the relay's own pairing frame. */
  let got: string[];
  let toBrowser: WebSocket | null;

  beforeEach(async () => {
    got = [];
    toBrowser = null;
    engine = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    engine.on("connection", (ws) => {
      let first = true;
      ws.on("message", (d) => {
        const m = JSON.parse(String(d));
        if (first) {
          first = false;
          ws.send(JSON.stringify({ type: "paired" }));
          toBrowser = ws;
          return;
        }
        got.push(m.type);
        if (m.type === "whoami")
          ws.send(JSON.stringify({ type: "whoami", id: "e1", token: "tok" }));
      });
    });
    await new Promise((r) => engine.once("listening", r));
    reg = createRegistry({ bindings: createBindings(undefined, () => {}) });
    reg.upsert({
      id: "e1",
      token: "tok",
      hostname: "h",
      machineFingerprint: "",
      addresses: {
        loopback: "127.0.0.1",
        lanIps: [],
        port: (engine.address() as AddressInfo).port,
      },
      publicIpHint: "127.0.0.1",
    });
    server = createServer();
    attachEngineProxy(server, reg);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    for (const c of engine.clients) c.terminate();
    await new Promise((r) => engine.close(r));
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });

  const open = (holder: string): Promise<{ ws: WebSocket; seen: string[] }> =>
    new Promise((resolve, reject) => {
      const ticket = encodeURIComponent(issueEngineTicket("e1", holder));
      const ws = new WebSocket(
        `ws://127.0.0.1:${port}/api/engine/e1/ws?ticket=${ticket}`,
      );
      const seen: string[] = [];
      ws.on("message", (d) => seen.push(JSON.parse(String(d)).type));
      ws.once("open", () => resolve({ ws, seen }));
      ws.once("error", reject);
    });

  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 100 && !ok(); i++)
      await new Promise((r) => setTimeout(r, 20));
    expect(ok()).toBe(true);
  };

  it("lets a non-holder probe, holds its driving, and lets it all through once it claims", async () => {
    const { ws, seen } = await open("bob");
    ws.send(JSON.stringify({ type: "whoami" }));
    ws.send(JSON.stringify({ type: "hello", role: "driver" }));
    await until(() => seen.includes("whoami"));
    expect(got).toEqual(["whoami"]);
    // The engine's pushes do not reach a socket with no claim behind it.
    toBrowser?.send(JSON.stringify({ type: "state", playing: true }));
    await new Promise((r) => setTimeout(r, 100));
    expect(seen).toEqual(["whoami"]);

    reg.claim("e1", { project: null, holder: "bob" });
    await until(() => got.includes("hello"));
    toBrowser?.send(JSON.stringify({ type: "state", playing: true }));
    await until(() => seen.includes("state"));
    ws.close();
  });

  it("does not let another account's claim open the way", async () => {
    reg.claim("e1", { project: null, holder: "alice" });
    const { ws } = await open("bob");
    ws.send(JSON.stringify({ type: "transport", action: "play" }));
    await new Promise((r) => setTimeout(r, 300));
    expect(got).not.toContain("transport");
    ws.close();
  });
});

describe("the WebRTC offer", () => {
  let reg: EngineRegistry;
  let server: Server;
  let base: string;
  const signal = vi.fn(async () => "answer");

  beforeEach(async () => {
    reg = createRegistry({ bindings: createBindings(undefined, () => {}) });
    reg.upsert({
      id: "e1",
      token: "tok",
      hostname: "h",
      machineFingerprint: "",
      addresses: { loopback: "127.0.0.1", lanIps: [], port: 8765 },
    });
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as { user?: object }).user = { email: "bob" };
      next();
    });
    const tunnels = { signal, has: () => true, isRenderer: () => false };
    app.use(
      "/api",
      engineRegistryRouter(reg, tunnels as never, () => {}),
    );
    server = app.listen(0);
    await new Promise<void>((r) => server.once("listening", () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });

  const offer = () =>
    fetch(`${base}/api/engine/e1/rtc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sdp: "v=0" }),
    });

  it("is refused without a claim, and answered with one", async () => {
    expect((await offer()).status).toBe(403);
    expect(signal).not.toHaveBeenCalled();
    reg.claim("e1", { project: null, holder: "alice" });
    expect((await offer()).status).toBe(403);
    reg.claim("e1", { project: null, holder: "bob" });
    const r = await offer();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ sdp: "answer" });
  });

  it("mints each listed engine a ticket for the asking account, naming only its own claims", async () => {
    reg.owners.assign("e1", "bob");
    reg.owners.share("e1", ["alice"]);
    reg.claim("e1", { project: "@local/ws/a.k7", holder: "alice" });
    const list = (await (await fetch(`${base}/api/engines`)).json()) as {
      proxyTicket: string;
      heldBy?: string;
      assigned: boolean;
    }[];
    expect(verifyEngineTicket(list[0]?.proxyTicket ?? "")?.holder).toBe("bob");
    expect(list[0]?.assigned).toBe(true);
    expect(list[0]?.heldBy).toBeUndefined();
  });
});
