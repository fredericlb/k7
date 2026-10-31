// upgrade.test.ts — a socket accepted through `acceptSocket` survives a peer's protocol fault by
// ending itself, and `heartbeat` drops a peer that stopped answering pings.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { sendBadFrame } from "./testBadFrame.ts";
import { acceptSocket, heartbeat } from "./upgrade.ts";

let server: Server;
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

async function serving(serve: (ws: WebSocket) => void): Promise<number> {
  const wss = new WebSocketServer({ noServer: true });
  server = createServer();
  server.on("upgrade", (req, socket, head) =>
    acceptSocket(wss, req, socket, head, serve),
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return (server.address() as AddressInfo).port;
}

describe("acceptSocket", () => {
  it("terminates a socket that sent an RSV1 frame, even one already closing", async () => {
    const closed = vi.fn();
    const port = await serving((ws) => {
      ws.on("close", closed);
      ws.close(1008, "refused");
    });
    expect(await sendBadFrame(port, "/x")).toContain("101");
    await vi.waitFor(() => expect(closed).toHaveBeenCalled());
  });
});

describe("heartbeat", () => {
  it("terminates a peer that leaves a ping unanswered", async () => {
    // The server's own close is awaited: the client can hear the hang-up before the terminated socket reads CLOSED.
    let servedClosed!: Promise<WebSocket>;
    const port = await serving((ws) => {
      servedClosed = new Promise((r) => ws.once("close", () => r(ws)));
      heartbeat(ws, 30);
    });
    const client = new WebSocket(`ws://127.0.0.1:${port}/x`, {
      autoPong: false,
    });
    await new Promise((r) => client.on("close", r));
    expect((await servedClosed).readyState).toBe(WebSocket.CLOSED);
  });

  it("keeps a peer that answers", async () => {
    const port = await serving((ws) => heartbeat(ws, 20));
    const client = new WebSocket(`ws://127.0.0.1:${port}/x`);
    await new Promise((r) => client.on("open", r));
    await new Promise((r) => setTimeout(r, 120));
    expect(client.readyState).toBe(WebSocket.OPEN);
    client.close();
  });
});
