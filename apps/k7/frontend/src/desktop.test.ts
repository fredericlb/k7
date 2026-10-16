// desktop.test.ts — the desktop app is told apart by its preload's bridge, and a browser tab has none.

import { afterEach, describe, expect, it } from "vitest";
import { desktop } from "./desktop";

const g = globalThis as { window?: unknown };

afterEach(() => {
  delete g.window;
});

describe("desktop", () => {
  it("is not the app when no window carries the bridge", async () => {
    g.window = {};
    expect(desktop.isDesktop).toBe(false);
    expect(await desktop.state()).toBeNull();
  });

  it("reads the app's state through the bridge", async () => {
    const state = { server: "https://st0.app", lanUrls: [] };
    g.window = { studioDesktop: { state: async () => state } };
    expect(desktop.isDesktop).toBe(true);
    expect(await desktop.state()).toEqual(state);
  });

  it("answers null when the main process cannot", async () => {
    g.window = {
      studioDesktop: { state: () => Promise.reject(new Error("gone")) },
    };
    expect(await desktop.state()).toBeNull();
  });
});
