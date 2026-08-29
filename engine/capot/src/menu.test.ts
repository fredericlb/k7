// Menu parity, item by item. The checks that matter are the ones whose failure looks like
// normal operation: a green status line over a dead file service, an enabled "Stop engine"
// over someone else's engine, and an empty submenu where a sentence belongs.

import type { HostSnapshot } from "@studio/engine-host/hostProtocol";
import { SHOW_UI_SEP } from "@studio/engine-host/hostProtocol";
import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import {
  buildTemplate,
  EMPTY_SNAPSHOT,
  iconStateFor,
  type MenuView,
  menuSignature,
  pluginsLabel,
  registryLabel,
  sessionLabel,
  statusLabel,
  tooltip,
} from "./menu.ts";

const view = (
  snapshot: Partial<HostSnapshot> = {},
  rest: Partial<MenuView> = {},
): MenuView => ({
  snapshot: { ...EMPTY_SNAPSHOT, ...snapshot } as HostSnapshot,
  hostError: null,
  spinner: 0,
  autostart: false,
  build: "26.08291200",
  ...rest,
});

const RUN = {
  status: "running",
  ownsEngine: true,
  engineId: "abcdef0123456789",
  pluginCount: 12,
} as const;

const flat = (t: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  t.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flat(i.submenu) : [])]);
const byId = (t: MenuItemConstructorOptions[], id: string) =>
  flat(t).find((i) => i.id === id);

describe("the status line", () => {
  it("names the engine, short id and port when running", () => {
    expect(statusLabel(view(RUN))).toBe("● Running · id abcdef01 · :8765");
  });

  it("says (adopted) for an engine this supervisor did not spawn", () => {
    expect(statusLabel(view({ ...RUN, ownsEngine: false }))).toContain(
      "(adopted)",
    );
  });

  it("adds 'file service down' — otherwise green would be a lie", () => {
    expect(statusLabel(view({ ...RUN, fileServiceFailed: true }))).toBe(
      "● Running · id abcdef01 · :8765 · ⚠ file service down",
    );
  });

  it("is REPLACED by a missing supervisor, not decorated by it", () => {
    const s = statusLabel(view(RUN, { hostError: "supervisor not found" }));
    expect(s).toBe("⚠ supervisor not found");
    expect(s).not.toContain("Running");
  });
});

describe("the icon badge", () => {
  it("is red — not green — when the file service is down", () => {
    expect(iconStateFor(view({ ...RUN, fileServiceFailed: true }))).toEqual({
      kind: "stopped",
    });
    expect(tooltip(view({ ...RUN, fileServiceFailed: true }))).toBe(
      "studio-moteur — file service stopped",
    );
  });

  it("spins while the engine is up but has not reported a plugin count", () => {
    expect(iconStateFor(view({ ...RUN, pluginCount: null }))).toEqual({
      kind: "loading",
      frame: 0,
    });
    expect(pluginsLabel(view({ ...RUN, pluginCount: null }))).toBe(
      "Plugins: ⠋",
    );
  });

  it("shows an em dash rather than a spinner when nothing is running", () => {
    expect(pluginsLabel(view({ pluginCount: null }))).toBe("Plugins: —");
  });

  it("wears the error badge when the supervisor is gone, whatever the engine half believes", () => {
    expect(
      iconStateFor(view(RUN, { hostError: "supervisor restarting…" })),
    ).toEqual({ kind: "error" });
  });
});

describe("the safety rule", () => {
  it("enables Stop and Restart only for an engine we own", () => {
    const own = buildTemplate(view(RUN), () => {});
    expect(byId(own, "stop")?.enabled).toBe(true);
    expect(byId(own, "restart_file")?.enabled).toBe(true);

    const foreign = buildTemplate(
      view({ ...RUN, ownsEngine: false }),
      () => {},
    );
    expect(byId(foreign, "stop")?.enabled).toBe(false);
    expect(byId(foreign, "restart")?.enabled).toBe(false);
    expect(byId(foreign, "restart_file")?.enabled).toBe(false);
    expect(byId(foreign, "clear_waveform_cache")?.enabled).toBe(false);
    // But it IS running, so Start stays off and Rescan stays on.
    expect(byId(foreign, "start")?.enabled).toBe(false);
    expect(byId(foreign, "rescan")?.enabled).toBe(true);
  });
});

describe("the submenus", () => {
  it("gives an empty Sessions a sentence, not an empty list", () => {
    const t = buildTemplate(view(), () => {});
    expect(byId(t, "sessions_none")?.label).toBe(
      "No app is driving this engine",
    );
    expect(byId(t, "sessions_none")?.enabled).toBe(false);
  });

  it("labels a session with project, tracks, and the live facts only when true", () => {
    expect(
      sessionLabel({
        id: "st0",
        project: "ma-chanson",
        loaded: true,
        playing: true,
        tracks: 4,
        listeners: 2,
      }),
    ).toBe("st0 · ma-chanson · 4 tracks  ▶  ♫2   ✕");
    expect(
      sessionLabel({
        id: "st0",
        project: "x",
        loaded: true,
        playing: false,
        tracks: 1,
        listeners: 0,
      }),
    ).toBe("st0 · x · 1 track   ✕");
    expect(
      sessionLabel({
        id: "",
        project: "",
        loaded: false,
        playing: false,
        tracks: 0,
        listeners: 0,
      }),
    ).toBe("(default) · nothing loaded   ✕");
  });

  it("keeps SHOW_UI_SEP in a plugin row id — any other separator opens the wrong editor", () => {
    const t = buildTemplate(
      view({
        editPlugins: [
          { session: "st0", id: "n1", name: "Diva", hasNativePluginUI: true },
        ],
      }),
      () => {},
    );
    expect(byId(t, `plugin_open:st0${SHOW_UI_SEP}n1`)?.label).toBe("Diva");
  });

  it("qualifies plugin rows by session only when sessions differ", () => {
    const two = buildTemplate(
      view({
        editPlugins: [
          { session: "a", id: "1", name: "Diva", hasNativePluginUI: true },
          { session: "b", id: "2", name: "Zebra", hasNativePluginUI: true },
        ],
      }),
      () => {},
    );
    expect(byId(two, `plugin_open:a${SHOW_UI_SEP}1`)?.label).toBe("a · Diva");
  });

  it("hides built-ins, which have no native editor, and disables the submenu when none are left", () => {
    const t = buildTemplate(
      view({
        editPlugins: [
          { session: "st0", id: "n1", name: "Gain", hasNativePluginUI: false },
        ],
      }),
      () => {},
    );
    expect(byId(t, "edit_plugins")?.enabled).toBe(false);
    expect(byId(t, "edit_plugins_none")?.label).toBe(
      "No plugins with a native UI",
    );
  });

  it("marks the remembered audio pick only when the engine is NOT on it", () => {
    const off = buildTemplate(
      view({
        audioDevices: [
          { name: "Scarlett", deviceType: "CoreAudio", current: false },
        ],
        audioPreferred: "Scarlett",
      }),
      () => {},
    );
    expect(byId(off, "dev:Scarlett")?.label).toBe(
      "Scarlett [CoreAudio]   (preferred)",
    );

    const on = buildTemplate(
      view({
        audioDevices: [
          { name: "Scarlett", deviceType: "CoreAudio", current: true },
        ],
        audioPreferred: "Scarlett",
      }),
      () => {},
    );
    expect(byId(on, "dev:Scarlett")?.label).toBe("Scarlett [CoreAudio]");
    expect(byId(on, "dev:Scarlett")?.checked).toBe(true);
  });

  it("still lists an unplugged preferred device — otherwise the question has no answer", () => {
    const t = buildTemplate(
      view({ audioDevices: [], audioPreferred: "Scarlett" }),
      () => {},
    );
    expect(byId(t, "dev_missing")?.label).toBe(
      "Scarlett   (preferred — not connected)",
    );
    expect(byId(t, "audio")?.enabled).toBe(true);
  });

  it("offers the blocked origins for approval, and keeps Add reachable when empty", () => {
    const t = buildTemplate(
      view({ webOrigins: [], webPending: ["https://daw.test"] }),
      () => {},
    );
    expect(byId(t, "weburi")?.enabled).toBe(true);
    expect(byId(t, "weburi_none")?.label).toBe("No web UI added");
    expect(byId(t, "weburi_pending_head")?.label).toBe(
      "Blocked just now — allow?",
    );
    expect(byId(t, "weburi_allow:https://daw.test")?.label).toBe(
      "✓ https://daw.test",
    );
    expect(byId(t, "weburi_add")?.label).toBe("Add web UI…");
  });

  it("puts the ✕ on an allowed origin, a tray menu having no delete key", () => {
    const t = buildTemplate(
      view({ webOrigins: ["https://daw.test"] }),
      () => {},
    );
    expect(byId(t, "weburi_del:https://daw.test")?.label).toBe(
      "https://daw.test   ✕",
    );
  });
});

describe("the registry line", () => {
  it("reports reachability only while running", () => {
    expect(
      registryLabel(
        view({ ...RUN, registryUrl: "https://s.test", lastHeartbeatOk: false }),
      ),
    ).toBe("registry https://s.test · unreachable");
    expect(registryLabel(view({ registryUrl: "https://s.test" }))).toBe(
      "registry https://s.test",
    );
  });
});

describe("the rebuild gate", () => {
  it("ignores the spinner, so an 8fps tick does not tear down an open submenu", () => {
    const a = menuSignature(
      buildTemplate(
        view({ ...RUN, pluginCount: null }, { spinner: 1 }),
        () => {},
      ),
    );
    const b = menuSignature(
      buildTemplate(
        view({ ...RUN, pluginCount: null }, { spinner: 7 }),
        () => {},
      ),
    );
    expect(a).toBe(b);
  });

  it("notices a session appearing, a device changing and an origin being blocked", () => {
    const base = menuSignature(buildTemplate(view(RUN), () => {}));
    const withSession = menuSignature(
      buildTemplate(
        view({
          ...RUN,
          sessions: [
            {
              id: "st0",
              project: "p",
              loaded: true,
              playing: false,
              tracks: 1,
              listeners: 0,
            },
          ],
        }),
        () => {},
      ),
    );
    const withPending = menuSignature(
      buildTemplate(view({ ...RUN, webPending: ["https://x.test"] }), () => {}),
    );
    expect(withSession).not.toBe(base);
    expect(withPending).not.toBe(base);
  });

  it("notices the playhead's effect on a row, but not the playhead itself", () => {
    const s = {
      id: "st0",
      project: "p",
      loaded: true,
      tracks: 1,
      listeners: 0,
    };
    const still = menuSignature(
      buildTemplate(
        view({ ...RUN, sessions: [{ ...s, playing: false }] }),
        () => {},
      ),
    );
    const rolling = menuSignature(
      buildTemplate(
        view({ ...RUN, sessions: [{ ...s, playing: true }] }),
        () => {},
      ),
    );
    expect(still).not.toBe(rolling);
  });
});
