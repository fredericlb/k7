// The rebasing a QR code rests on: what the desktop window shows itself is not what a phone
// can open, and the two are told apart by the ORIGIN alone.

import { describe, expect, it } from "vitest";
import { isLoopbackOrigin, remoteUrl } from "./remoteUrl.ts";

const LAN = ["http://192.168.1.20:8780", "http://172.28.0.1:8780"];

describe("which origins only this machine can reach", () => {
  it("knows the four spellings of loopback", () => {
    for (const o of [
      "http://localhost:8780",
      "http://127.0.0.1:8780",
      "http://127.1.2.3:5223",
      "http://[::1]:8780",
      "http://st0.localhost",
    ])
      expect(isLoopbackOrigin(o), o).toBe(true);
  });

  it("and does not mistake a real name or a LAN address for one", () => {
    for (const o of [
      "https://studio.frediver.se",
      "https://st0.priv.frediver.se",
      "http://192.168.1.20:8780",
      "http://localhosting.example.com",
    ])
      expect(isLoopbackOrigin(o), o).toBe(false);
  });
});

describe("rebasing an address for a second device", () => {
  it("puts a loopback address on the first LAN base, path and query intact", () => {
    expect(
      remoteUrl(
        "http://127.0.0.1:8780/lemo/mymix.st0/@external/desk?x=1#y",
        LAN,
        "http://127.0.0.1:8780",
      ),
    ).toBe("http://192.168.1.20:8780/lemo/mymix.st0/@external/desk?x=1#y");
  });

  it("leaves a hosted address alone — it is already reachable, and has no lanUrls anyway", () => {
    const url = "https://studio.frediver.se/lemo/mymix.st0/@external/desk";
    expect(remoteUrl(url, [], "https://studio.frediver.se")).toBe(url);
  });

  it("answers null rather than an address nobody can open", () => {
    // A desktop window on a machine with no network: there is no second device to reach it.
    expect(
      remoteUrl(
        "http://127.0.0.1:8780/lemo/mymix.st0",
        [],
        "http://127.0.0.1:8780",
      ),
    ).toBeNull();
  });
});
