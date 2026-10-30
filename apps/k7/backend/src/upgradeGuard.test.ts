import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { guardUpgrades, SERVED_UPGRADES } from "./upgradeGuard.ts";

let server: Server;
afterEach(() => new Promise<void>((done) => server.close(() => done())));

const listen = async (): Promise<number> => {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return (server.address() as { port: number }).port;
};

/** Send an upgrade by hand and read what comes back before `ms`, or "" when nothing does. */
const upgrade = (port: number, path: string, ms = 1500): Promise<string> =>
  new Promise((done) => {
    const s = connect(port, "127.0.0.1", () =>
      s.write(
        `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
      ),
    );
    let got = "";
    const t = setTimeout(() => {
      s.destroy();
      done(got);
    }, ms);
    s.on("data", (d) => {
      got += d.toString();
    });
    s.on("close", () => {
      clearTimeout(t);
      done(got);
    });
  });

describe("guardUpgrades", () => {
  it("refuses an upgrade no listener serves, instead of leaving it open", async () => {
    server = createServer();
    // A listener that ignores what is not its own, as every one here does.
    server.on("upgrade", () => undefined);
    guardUpgrades(server, SERVED_UPGRADES, () => undefined);
    const port = await listen();
    expect(await upgrade(port, "/nobody")).toMatch(/^HTTP\/1\.1 404/);
  });

  it("leaves a served path to its own listener", async () => {
    server = createServer();
    server.on("upgrade", (_req, socket) => {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    });
    guardUpgrades(server, SERVED_UPGRADES, () => undefined);
    const port = await listen();
    expect(await upgrade(port, "/api/cameras/ws?ticket=x")).toMatch(
      /^HTTP\/1\.1 401/,
    );
  });

  it("keeps the server up when a held upgrade socket is reset", async () => {
    server = createServer();
    const lines: string[] = [];
    // A served path whose listener holds the socket, as a slow ticket check does.
    server.on("upgrade", () => undefined);
    guardUpgrades(server, SERVED_UPGRADES, (l) => lines.push(l));
    const port = await listen();
    await new Promise<void>((done) => {
      const s = connect(port, "127.0.0.1", () => {
        s.write(
          "GET /api/sync HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
        );
        setTimeout(() => {
          s.resetAndDestroy();
          setTimeout(done, 200);
        }, 100);
      });
    });
    // Still answering: the reset was logged, not thrown.
    expect(await upgrade(port, "/nobody")).toMatch(/^HTTP\/1\.1 404/);
    expect(lines.some((l) => l.startsWith("socket:"))).toBe(true);
  });

  it("names every path a listener of this server takes", () => {
    const served = (p: string) => SERVED_UPGRADES.some((r) => r.test(p));
    expect(served("/api/engine/abc/ws")).toBe(true);
    expect(served("/api/engine-tunnel")).toBe(true);
    expect(served("/api/engine-tunnel/local/a1")).toBe(true);
    expect(served("/api/sync")).toBe(true);
    expect(served("/api/cameras/ws")).toBe(true);
    expect(served(`/api/public/share/${"a".repeat(64)}/play`)).toBe(true);
    expect(served("/")).toBe(false);
    expect(served("/api/engine/abc")).toBe(false);
  });
});
