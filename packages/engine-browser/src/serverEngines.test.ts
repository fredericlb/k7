// The merge of a machine's own engines with its main server's: the local route wins an id both list,
// and only an entry marked `via` is ever taken from the server's side.

import { describe, expect, it } from "vitest";
import { candidatesFor, type ProbeTarget } from "./probe.ts";
import { isThroughServer, mergeEngines } from "./serverEngines.ts";

const VIA = { origin: "https://app.k7.rocks" };
const near = (id: string) => ({ id });
const far = (id: string) => ({ id, via: VIA });

describe("mergeEngines", () => {
  it("lists this machine's engines first, then the server's", () => {
    const out = mergeEngines([near("tablet")], [far("tom"), far("srv")]);
    expect(out.map((e) => e.id)).toEqual(["tablet", "tom", "srv"]);
    expect(out.map(isThroughServer)).toEqual([false, true, true]);
  });

  it("keeps the local route for an engine both list", () => {
    const out = mergeEngines([near("tom")], [far("tom"), far("srv")]);
    expect(out).toEqual([near("tom"), far("srv")]);
  });

  it("drops a server entry with no via, and a duplicate", () => {
    const out = mergeEngines([], [near("plain"), far("tom"), far("tom")]);
    expect(out).toEqual([far("tom")]);
  });
});

describe("candidatesFor an engine through a server", () => {
  const target: ProbeTarget = {
    id: "tom",
    addresses: { loopback: "127.0.0.1", lanIps: ["192.168.1.9"], port: 8765 },
    proxyTicket: "tk",
    rtc: true,
    via: VIA,
  };
  // The probe reads `location` for the page's scheme; a node test has none.
  globalThis.location ??= {
    protocol: "http:",
    href: "http://127.0.0.1:18789/",
  } as Location;

  it("offers that server's relay alone, never this machine's loopback, its LAN or WebRTC", () => {
    expect(candidatesFor(target, "")).toEqual([
      { url: "wss://app.k7.rocks/api/engine/tom/ws?ticket=tk", direct: false },
    ]);
  });

  it("offers nothing without the server's ticket", () => {
    expect(candidatesFor({ ...target, proxyTicket: undefined }, "")).toEqual(
      [],
    );
  });
});
