// tunnel.test.ts — the tunnel end to end on real sockets: a hub on an HTTP server, an agent
// dialling it, and a fake engine. What it pins is the contract docs/tunnel.md states: the engine
// only ever sees local paths, a file is present BEFORE the frame naming it arrives, and a file
// the engine wrote is on the server BEFORE the frame naming it does.

import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { TunnelChannel } from "./channel.ts";
import { TunnelHub } from "./hub.ts";
import { type AgentHandle, agentKinds } from "./testAgents.ts";

const TOKEN = "tok";

function listen(server: Server): Promise<number> {
  return new Promise((res) =>
    server.listen(0, "127.0.0.1", () =>
      res((server.address() as AddressInfo).port),
    ),
  );
}

const until = async (ok: () => boolean, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe.each(agentKinds)("the engine tunnel — $name agent", ({ make }) => {
  let server: Server;
  let hub: TunnelHub;
  let agent: AgentHandle;
  let engine: WebSocketServer;
  let engineGot: string[];
  let engineSock: WebSocket | null;
  let remote: string;
  let cache: string;
  let port: number;

  beforeEach(async () => {
    remote = mkdtempSync(join(tmpdir(), "tunnel-remote-"));
    cache = mkdtempSync(join(tmpdir(), "tunnel-cache-"));
    engineGot = [];
    engineSock = null;
    engine = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    engine.on("connection", (s) => {
      engineSock = s;
      s.on("message", (d) => engineGot.push(d.toString()));
    });
    await new Promise((r) => engine.once("listening", r));
    server = createServer();
    hub = new TunnelHub({
      verify: (id, t) => id === "e1" && t === TOKEN,
      log: () => {},
    });
    hub.attach(server);
    port = await listen(server);
    agent = make({
      registryUrl: `http://127.0.0.1:${port}`,
      id: "e1",
      token: TOKEN,
      enginePort: (engine.address() as AddressInfo).port,
      cacheDir: cache,
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

  const openShared = async (): Promise<TunnelChannel> => {
    const ch = await hub.openReady("e1", [
      { remote, name: "ws", writable: true },
    ]);
    if (!ch) throw new Error("no channel");
    return ch;
  };

  it("refuses a supervisor with the wrong token", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/engine-tunnel?id=e1`, {
      headers: { "x-studio-engine-token": "nope" },
    });
    const status = await new Promise<number>((res) =>
      ws.on("unexpected-response", (_q, r) => res(r.statusCode ?? 0)),
    );
    expect(status).toBe(403);
  });

  it("passes frames untouched on a channel that shares nothing", async () => {
    const ch = await hub.openReady("e1");
    ch?.send(
      JSON.stringify({
        type: "transport",
        action: "play",
        file: `${remote}/a.wav`,
      }),
    );
    await until(() => engineGot.length === 1);
    expect(JSON.parse(engineGot[0]).file).toBe(`${remote}/a.wav`);
  });

  it("downloads a file before the frame naming it reaches the engine", async () => {
    mkdirSync(join(remote, "song", "audio"), { recursive: true });
    writeFileSync(join(remote, "song", "audio", "kick.wav"), "RIFF-kick");
    const ch = await openShared();
    ch.send(
      JSON.stringify({
        type: "project",
        tracks: [{ clips: [{ file: `${remote}/song/audio/kick.wav` }] }],
        recordDir: `${remote}/song/clips`,
      }),
    );
    await until(() => engineGot.length === 1);
    const doc = JSON.parse(engineGot[0]);
    const local = doc.tracks[0].clips[0].file;
    expect(local).toBe(join(cache, "ws", "song", "audio", "kick.wav"));
    expect(readFileSync(local, "utf8")).toBe("RIFF-kick");
    expect(doc.recordDir).toBe(join(cache, "ws", "song", "clips"));
  });

  it("uploads a file the engine wrote before the frame naming it reaches the server", async () => {
    const ch = await openShared();
    const got: string[] = [];
    ch.on("message", (d: Buffer) => got.push(d.toString()));
    ch.send(
      JSON.stringify({ type: "project", recordDir: `${remote}/song/clips` }),
    );
    await until(() => engineGot.length === 1);
    const localDir = JSON.parse(engineGot[0]).recordDir;
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, "take-1.wav"), "RIFF-take");
    engineSock?.send(
      JSON.stringify({ type: "recorded", file: join(localDir, "take-1.wav") }),
    );
    await until(() => got.length === 1);
    const file = JSON.parse(got[0]).file;
    expect(file).toBe(`${remote}/song/clips/take-1.wav`);
    expect(readFileSync(file, "utf8")).toBe("RIFF-take");
  });

  it("moves files larger than one chunk, both ways, byte for byte", async () => {
    const big = randomBytes(1_500_000);
    writeFileSync(join(remote, "big.wav"), big);
    const ch = await openShared();
    const got: string[] = [];
    ch.on("message", (d: Buffer) => got.push(d.toString()));
    ch.send(JSON.stringify({ type: "project", file: `${remote}/big.wav` }));
    await until(() => engineGot.length === 1);
    const local = JSON.parse(engineGot[0]).file;
    expect(readFileSync(local).equals(big)).toBe(true);
    const back = randomBytes(700_000);
    writeFileSync(join(cache, "ws", "back.wav"), back);
    engineSock?.send(
      JSON.stringify({ type: "recorded", file: join(cache, "ws", "back.wav") }),
    );
    await until(() => got.length === 1);
    expect(readFileSync(join(remote, "back.wav")).equals(back)).toBe(true);
  });

  it("does not fetch a file again that it already holds", async () => {
    writeFileSync(join(remote, "a.wav"), "one");
    const ch = await openShared();
    const frame = JSON.stringify({ type: "project", file: `${remote}/a.wav` });
    ch.send(frame);
    await until(() => engineGot.length === 1);
    const local = JSON.parse(engineGot[0]).file;
    writeFileSync(local, "tampered-but-same-len"); // a re-download would restore "one"
    ch.send(JSON.stringify({ type: "tracks", file: `${remote}/a.wav` }));
    await until(() => engineGot.length === 2);
    expect(readFileSync(local, "utf8")).toBe("tampered-but-same-len");
  });

  it("serves nothing through a symlink that leaves the shared tree", async (ctx) => {
    const outside = mkdtempSync(join(tmpdir(), "tunnel-outside-"));
    writeFileSync(join(outside, "secret"), "nope");
    try {
      symlinkSync(join(outside, "secret"), join(remote, "link.wav"));
    } catch {
      // A file link needs Developer Mode or an admin on Windows.
      ctx.skip();
    }
    const ch = await openShared();
    ch.send(JSON.stringify({ type: "project", file: `${remote}/link.wav` }));
    await until(() => engineGot.length === 1);
    expect(existsSync(JSON.parse(engineGot[0]).file)).toBe(false);
  });

  it("reaches the engine from a bound loopback path", async () => {
    const path = hub.bindLocal("e1", []);
    const client = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    await new Promise((r) => client.once("open", r));
    client.send(JSON.stringify({ type: "whoami" }));
    await until(() => engineGot.length === 1);
    expect(JSON.parse(engineGot[0]).type).toBe("whoami");
    client.close();
  });
});
