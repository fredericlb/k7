// status.test.ts — the menu bar's own words and the icon's state, as tray.rs drew them.

import {
  EMPTY_SNAPSHOT,
  type Snapshot,
} from "@studio/supervisor-host/hostProtocol";
import { describe, expect, it } from "vitest";
import { downloadsLine, iconState, statusLine } from "./status.ts";

const running: Snapshot = {
  ...EMPTY_SNAPSHOT,
  status: "running",
  ownsEngine: true,
  engineId: "3f2a91c4deadbeef",
  pluginCount: 12,
};

const dl = (
  phase: "queued" | "downloading" | "unpacking" | "failed",
  label = "Piano",
) => ({
  name: label.toLowerCase(),
  label,
  received: 50,
  total: 200,
  phase,
});

describe("statusLine", () => {
  it("reads the running engine, and says when it is adopted", () => {
    expect(statusLine(running, null)).toBe("● Running · id 3f2a91c4 · :8765");
    expect(statusLine({ ...running, ownsEngine: false }, null)).toContain(
      "(adopted)",
    );
  });

  it("lets a missing supervisor replace everything", () => {
    expect(statusLine(running, "supervisor not found")).toBe(
      "⚠ supervisor not found",
    );
  });
});

describe("downloadsLine", () => {
  it("names the one in flight and counts the rest, else the first failure", () => {
    expect(downloadsLine([dl("downloading"), dl("queued", "Strings")])).toBe(
      "↓ Downloading Piano… 25% (+1 more)",
    );
    expect(downloadsLine([dl("failed")])).toBe("⚠ Piano: download failed");
    expect(downloadsLine([])).toBeNull();
  });
});

describe("iconState", () => {
  it("spins while scanning or fetching, and warns over everything when the supervisor is gone", () => {
    expect(iconState(running, null, 3)).toEqual({ kind: "running" });
    expect(iconState({ ...running, pluginCount: undefined }, null, 3)).toEqual({
      kind: "loading",
      frame: 3,
    });
    expect(
      iconState({ ...running, downloads: [dl("downloading")] }, null, 0).kind,
    ).toBe("loading");
    expect(iconState(running, "supervisor restarting…", 0)).toEqual({
      kind: "error",
    });
    expect(iconState(EMPTY_SNAPSHOT, null, 0)).toEqual({ kind: "stopped" });
  });
});
