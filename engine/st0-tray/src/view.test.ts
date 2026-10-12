// view.test.ts — the settings rows, as settingswin.rs built them.

import {
  EMPTY_SNAPSHOT,
  type Snapshot,
  snapshotOf,
} from "@studio/supervisor-host/hostProtocol";
import { describe, expect, it } from "vitest";
import { audioRows, differs, sessionRows, view } from "./view.ts";

const device = (name: string, current = false) => ({
  name,
  deviceType: "CoreAudio",
  current,
  currentInput: false,
});

describe("audioRows", () => {
  it("lists the ranking first, keeps an unplugged ranked name, then the unranked devices", () => {
    const rows = audioRows([device("B", true), device("C")], ["A", "B"]);
    expect(rows.map((r) => [r.name, r.rank, r.present, r.current])).toEqual([
      ["A", 1, false, false],
      ["B", 2, true, true],
      ["C", null, true, false],
    ]);
  });
});

describe("sessionRows", () => {
  it("nests openable plugins under their session and keeps the ones naming none", () => {
    const plugin = (session: string, id: string, ui: boolean, name = "") => ({
      session,
      id,
      name,
      hasNativePluginUI: ui,
    });
    const s = {
      id: "s1",
      project: "song",
      loaded: true,
      playing: false,
      tracks: 3,
      listeners: 0,
    };
    const { rows, orphans } = sessionRows(
      [s],
      [
        plugin("s1", "a", true, "Synth"),
        plugin("s1", "b", false),
        plugin("gone", "c", true),
      ],
    );
    expect(rows[0].plugins).toEqual([
      { session: "s1", id: "a", name: "Synth" },
    ]);
    expect(orphans).toEqual([{ session: "gone", id: "c", name: "c" }]);
  });
});

describe("view", () => {
  it("greys Stop and Restart for an adopted engine", () => {
    const adopted: Snapshot = {
      ...EMPTY_SNAPSHOT,
      status: "running",
      ownsEngine: false,
    };
    expect(view(adopted, null, "dev").system).toMatchObject({
      canStart: false,
      canAct: false,
    });
    expect(
      view({ ...adopted, ownsEngine: true }, null, "dev").system.canAct,
    ).toBe(true);
  });

  it("says scanning, not none, before the engine answers", () => {
    expect(view(EMPTY_SNAPSHOT, null, "dev").pluginCount).toBeNull();
  });
});

describe("snapshotOf", () => {
  it("fills the lists a frame left out", () => {
    const s = snapshotOf({
      status: "running",
      paths: { root: "/r", mergedLog: "" },
    });
    expect(s.downloads).toEqual([]);
    expect(s.paths.root).toBe("/r");
  });
});

describe("differs", () => {
  it("ignores what the window does not draw and catches what it does", () => {
    expect(
      differs(EMPTY_SNAPSHOT, { ...EMPTY_SNAPSHOT, userStopped: true }),
    ).toBe(false);
    expect(
      differs(EMPTY_SNAPSHOT, { ...EMPTY_SNAPSHOT, pluginsSig: "x" }),
    ).toBe(true);
    expect(
      differs(EMPTY_SNAPSHOT, {
        ...EMPTY_SNAPSHOT,
        pairRequests: [
          { requestId: "r", name: "", ip: "1.2.3.4", code: "123456", since: 0 },
        ],
      }),
    ).toBe(true);
  });
});
