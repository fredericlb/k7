// The camera relay, over real sockets: an upgrade is the only place `remoteAddress` and the
// engine token are read, so nothing below can be exercised any other way. What is asserted is
// the ROUTING and the two refusals — the SDP itself is the browsers' business and never ours.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createRegistry, type EngineRegistry } from "@studio/engine-registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { attachCameraRtc, mayOpen, resetCameraRtc } from "./cameraRtc.ts";

let server: Server;
let reg: EngineRegistry;
let port = 0;

const ENGINE = {
  id: "eng-1",
  token: "tok-1",
  hostname: "here",
  machineFingerprint: "fp",
  addresses: { loopback: "127.0.0.1", lanIps: [], port: 8765, filePort: 8770 },
};

beforeEach(async () => {
  resetCameraRtc();
  reg = createRegistry();
  reg.upsert(ENGINE);
  server = createServer((_req, res) => res.end());
  attachCameraRtc(server, reg);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  // Before close(), which otherwise waits on a socket a refused test deliberately left open.
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

const url = (q: string) => `ws://127.0.0.1:${port}/camera/rtc?${q}`;

/** Open a socket and settle either way: a refused upgrade is an `error`, never a close. */
function dial(q: string): Promise<WebSocket | Error> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url(q));
    ws.once("open", () => resolve(ws));
    ws.once("error", (e) => resolve(e));
  });
}

/** The next frame this socket receives, parsed. */
function next(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once("message", (d) => resolve(JSON.parse(String(d))));
  });
}

/** The engine token as the registry answers it — the one the file service asks the same device for. */
const verify = (id: string, token: string) =>
  id === ENGINE.id && token === ENGINE.token;

const q = (s: string) => new URLSearchParams(s);

describe("who may open the socket", () => {
  it("takes a host from this machine, and nobody else's", () => {
    expect(mayOpen("host", true, q(""), verify)).toBeNull();
    // Offering a lens is claiming to BE the machine; a LAN peer never is.
    expect(mayOpen("host", false, q(""), verify)).toBe("403 Forbidden");
  });

  it("takes a viewer from the LAN on the engine token, and refuses a wrong one", () => {
    expect(
      mayOpen("viewer", false, q("engine=eng-1&token=tok-1"), verify),
    ).toBeNull();
    expect(mayOpen("viewer", false, q("engine=eng-1&token=nope"), verify)).toBe(
      "401 Unauthorized",
    );
    expect(mayOpen("viewer", false, q(""), verify)).toBe("401 Unauthorized");
  });

  it("asks this machine's own window for no token, having nowhere to have got one", () => {
    expect(mayOpen("viewer", true, q(""), verify)).toBeNull();
  });

  it("refuses a role it does not have", () => {
    expect(mayOpen("stagehand", true, q(""), verify)).toBe("400 Bad Request");
    expect(mayOpen(null, true, q(""), verify)).toBe("400 Bad Request");
  });

  it("refuses the upgrade itself, over a real socket", async () => {
    expect(await dial("role=stagehand")).toBeInstanceOf(Error);
  });
});

describe("what it carries", () => {
  it("tells a viewer when no window is open, rather than leaving it waiting", async () => {
    const viewer = (await dial("role=viewer")) as WebSocket;
    viewer.send(JSON.stringify({ type: "want", label: "BRIO" }));
    expect(await next(viewer)).toMatchObject({ type: "problem" });
    viewer.close();
  });

  it("names the viewer to the host, and answers the named one alone", async () => {
    const host = (await dial("role=host")) as WebSocket;
    const viewer = (await dial("role=viewer")) as WebSocket;
    const heard = next(host);
    viewer.send(JSON.stringify({ type: "want", label: "BRIO" }));
    const want = await heard;
    expect(want).toMatchObject({ type: "want", label: "BRIO" });
    // The id is minted by the relay: neither browser may choose who it claims to be.
    expect(typeof want.from).toBe("string");

    const back = next(viewer);
    host.send(
      JSON.stringify({ type: "offer", to: want.from, sdp: { type: "offer" } }),
    );
    const offer = await back;
    expect(offer).toMatchObject({ type: "offer" });
    // Stripped on the way out: the viewer has no use for its own id, and no business knowing it.
    expect(offer.to).toBeUndefined();
    host.close();
    viewer.close();
  });

  it("tells the viewers when the window goes", async () => {
    const host = (await dial("role=host")) as WebSocket;
    const viewer = (await dial("role=viewer")) as WebSocket;
    const said = next(viewer);
    host.close();
    expect(await said).toMatchObject({ type: "problem" });
    viewer.close();
  });
});
