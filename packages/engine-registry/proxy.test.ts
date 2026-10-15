// proxy.test.ts — the relay's upgrade listener runs before any session check, so a request
// anyone can send must be answered and never thrown: a throw there ends the whole backend.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { connect } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachEngineProxy } from "./proxy.ts";
import { createRegistry } from "./registry.ts";

/** Send a raw upgrade for `path`, and answer the status line the server wrote back. */
const upgrade = (port: number, path: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const s = connect(port, "127.0.0.1", () =>
      s.write(
        `GET ${path} HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
      ),
    );
    let got = "";
    s.on("data", (d) => {
      got += d.toString();
    });
    s.on("close", () => resolve(got.split("\r\n")[0] ?? ""));
    s.on("error", reject);
  });

describe("the engine relay's upgrade", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    server = createServer();
    attachEngineProxy(server, createRegistry());
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
  });

  it("answers 400 to a malformed escape in the engine id, and keeps serving", async () => {
    expect(await upgrade(port, "/api/engine/%E0/ws")).toBe(
      "HTTP/1.1 400 Bad Request",
    );
    expect(await upgrade(port, "/api/engine/e1/ws?ticket=x")).toBe(
      "HTTP/1.1 401 Unauthorized",
    );
  });
});
