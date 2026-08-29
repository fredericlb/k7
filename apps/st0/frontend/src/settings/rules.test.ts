// These came off the tray menu with the screen, and they are the ones whose failure looks
// like working software: an enabled Stop on somebody else's engine, a green status over a dead
// file service, a plugin row whose id opens the wrong editor.

import type { HostSnapshot } from "@studio/engine-host/hostProtocol";
import { SHOW_UI_SEP } from "@studio/engine-host/hostProtocol";
import { describe, expect, it } from "vitest";
import type { DesktopState } from "../desktop";
import {
  audioRow,
  engineActions,
  fileServiceWarning,
  missingDevice,
  needsSessionPrefix,
  openablePlugins,
  pluginArg,
  pluginsLine,
  sessionRow,
  statusLine,
} from "./rules";

const snap = (over: Partial<HostSnapshot> = {}): HostSnapshot =>
  ({
    status: "stopped",
    ownsEngine: false,
    engineId: "abcdef0123456789",
    enginePort: 8765,
    filePort: 8770,
    fileServiceFailed: false,
    registryUrl: "https://studio.test",
    lastHeartbeatOk: true,
    pluginCount: null,
    audioDevices: [],
    audioPreferred: null,
    audioFallback: null,
    editPlugins: [],
    sessions: [],
    webOrigins: [],
    webPending: [],
    paths: { root: "", mergedLog: "", webOrigins: "" },
    ...over,
  }) as HostSnapshot;

const st = (
  snapshot: HostSnapshot | null,
  over: Partial<DesktopState> = {},
): DesktopState => ({
  snapshot,
  hostError: null,
  build: "26.08301200",
  autostart: false,
  identity: "fred@localhost",
  server: null,
  paired: false,
  lanUrls: [],
  ...over,
});

const RUN = { status: "running", ownsEngine: true, pluginCount: 12 } as const;

describe("the safety rule", () => {
  it("allows Stop only for an engine this supervisor spawned", () => {
    expect(engineActions(st(snap(RUN)))).toMatchObject({
      canStart: false,
      canStop: true,
    });
  });

  it("refuses it for an ADOPTED engine, and says whose it is", () => {
    const a = engineActions(st(snap({ ...RUN, ownsEngine: false })));
    expect(a.canStop).toBe(false);
    expect(a.reason).toContain("another supervisor");
    // But it IS running, so Start stays off too.
    expect(a.canStart).toBe(false);
  });

  it("offers Start when nothing is running, with nothing to explain", () => {
    const a = engineActions(st(snap()));
    expect(a).toMatchObject({ canStart: true, canStop: false });
    expect(a.reason).toBeUndefined();
  });
});

describe("the status line", () => {
  it("names the short id and the port", () => {
    expect(statusLine(st(snap(RUN)))).toBe("Running · id abcdef01 · :8765");
  });

  it("says (adopted) for an engine we did not start", () => {
    expect(statusLine(st(snap({ ...RUN, ownsEngine: false })))).toContain(
      "(adopted)",
    );
  });

  it("is REPLACED by a missing supervisor, not decorated by it", () => {
    const line = statusLine(
      st(snap(RUN), { hostError: "supervisor not found" }),
    );
    expect(line).toBe("⚠ supervisor not found");
    expect(line).not.toContain("Running");
  });

  it("warns about a dead file service — 'running' alone would be a lie", () => {
    expect(
      fileServiceWarning(snap({ ...RUN, fileServiceFailed: true })),
    ).toContain("no browser can reach a file");
    expect(fileServiceWarning(snap(RUN))).toBeUndefined();
  });
});

describe("the plugin count", () => {
  it("says scanning while the engine is up and silent, not 'none found'", () => {
    expect(pluginsLine(st(snap({ ...RUN, pluginCount: null })))).toBe(
      "Plugins: scanning…",
    );
  });

  it("says an em dash when nothing is running", () => {
    expect(pluginsLine(st(snap()))).toBe("Plugins: —");
  });

  it("says the number once there is one", () => {
    expect(pluginsLine(st(snap(RUN)))).toBe("Plugins: 12");
  });
});

describe("the audio rows", () => {
  const dev = (over = {}) =>
    ({
      name: "Scarlett",
      deviceType: "CoreAudio",
      current: false,
      ...over,
    }) as never;

  it("marks the remembered pick only when the engine is NOT on it", () => {
    const s = snap({ audioDevices: [dev()], audioPreferred: "Scarlett" });
    expect(audioRow(dev(), s).detail).toContain("preferred");

    const on = snap({
      audioDevices: [dev({ current: true })],
      audioPreferred: "Scarlett",
    });
    expect(audioRow(dev({ current: true }), on).detail).not.toContain(
      "preferred",
    );
  });

  it("still names an unplugged pick — otherwise the question has no answer on screen", () => {
    expect(
      missingDevice(snap({ audioDevices: [], audioPreferred: "Scarlett" })),
    ).toBe("Scarlett");
    expect(
      missingDevice(
        snap({ audioDevices: [dev()], audioPreferred: "Scarlett" }),
      ),
    ).toBeNull();
  });
});

describe("the sessions", () => {
  const s = (over = {}) =>
    ({
      id: "st0",
      project: "ma-chanson",
      loaded: true,
      playing: false,
      tracks: 4,
      listeners: 0,
      ...over,
    }) as never;

  it("names the project and its size", () => {
    expect(sessionRow(s()).label).toBe("st0 · ma-chanson · 4 tracks");
  });

  it("names the unnamed one, or the row reads as a session with no id", () => {
    expect(sessionRow(s({ id: "", loaded: false })).label).toBe(
      "(default) · nothing loaded",
    );
  });

  it("shows the live facts ONLY when true", () => {
    expect(sessionRow(s({ playing: true, listeners: 2 })).detail).toBe(
      "playing · 2 listening over the network",
    );
    expect(sessionRow(s()).detail).toBe("");
  });

  it("says one track, not one tracks", () => {
    expect(sessionRow(s({ tracks: 1 })).label).toContain("1 track");
  });
});

describe("the plugin rows", () => {
  const p = (over = {}) =>
    ({
      session: "st0",
      id: "n1",
      name: "Diva",
      hasNativePluginUI: true,
      ...over,
    }) as never;

  it("keeps SHOW_UI_SEP — any other separator opens the wrong editor, with no error", () => {
    expect(pluginArg("st0", "node-7")).toBe(`st0${SHOW_UI_SEP}node-7`);
  });

  it("hides built-ins, which have no native editor to open", () => {
    expect(
      openablePlugins(snap({ editPlugins: [p({ hasNativePluginUI: false })] })),
    ).toEqual([]);
  });

  it("qualifies by session only when sessions differ", () => {
    expect(needsSessionPrefix(snap({ editPlugins: [p()] }))).toBe(false);
    expect(
      needsSessionPrefix(
        snap({ editPlugins: [p(), p({ session: "b", id: "n2" })] }),
      ),
    ).toBe(true);
  });
});
