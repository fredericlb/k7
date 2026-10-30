// player.test.ts — a share's visitor socket that sends a malformed frame while it is being refused
// is terminated, and the backend goes on: the socket needs no account, so its fault is anybody's.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { TunnelHub } from "@studio/engine-tunnel/hub";
import { sendBadFrame } from "@studio/engine-tunnel/test-bad-frame";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SharePlayer } from "./player.ts";

let server: Server;
let port: number;
let detach: () => void;
const uncaught: Error[] = [];
const onUncaught = (e: Error) => uncaught.push(e);

beforeAll(async () => {
  process.on("uncaughtException", onUncaught);
  const player = new SharePlayer({
    tunnels: { renderer: () => null } as unknown as TunnelHub,
    librariesHome: () => "/nowhere",
    mediatekDir: () => "/nowhere",
    log: () => {},
  });
  server = createServer((_req, res) => res.end());
  detach = player.attach(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  process.off("uncaughtException", onUncaught);
  detach();
  await new Promise((r) => server.close(r));
});

describe("the share player's socket", () => {
  it("ends a refused visitor that sends an RSV1 frame, and the process survives", async () => {
    const status = await sendBadFrame(
      port,
      `/api/public/share/${"ab".repeat(32)}/play`,
    );
    expect(status).toContain("101");
    await new Promise((r) => setTimeout(r, 50));
    expect(uncaught).toEqual([]);
    expect(server.listening).toBe(true);
  });
});
