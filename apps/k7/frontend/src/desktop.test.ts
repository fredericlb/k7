// desktop.test.ts — a page served by the tray's backend is told apart by that backend's own answer, and a server's is not.

import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** Each case loads the module fresh: the local-app probe is asked once per page. */
async function load(routes: Record<string, unknown>) {
  vi.stubGlobal("window", {});
  vi.stubGlobal("fetch", async (url: string) => {
    const body = routes[url];
    return body === undefined
      ? { ok: false, json: async () => ({}) }
      : { ok: true, json: async () => body };
  });
  return (await import("./desktop")).desktop;
}

describe("desktop", () => {
  it("is not the machine's app on a server, which answers no /api/local", async () => {
    const desktop = await load({});
    expect(await desktop.state()).toBeNull();
  });

  it("names the server the tray's backend syncs with", async () => {
    const desktop = await load({
      "/api/local": { engine: true, version: "dev" },
      "/api/sync/remote": { paired: true, url: "wss://app.k7.rocks/api/sync" },
    });
    expect(await desktop.state()).toEqual({
      server: "https://app.k7.rocks",
      lanUrls: [],
    });
  });

  it("has no server before a pairing", async () => {
    const desktop = await load({
      "/api/local": { engine: true, version: "dev" },
      "/api/sync/remote": { paired: false, url: null },
    });
    expect(await desktop.state()).toEqual({ server: null, lanUrls: [] });
  });
});
