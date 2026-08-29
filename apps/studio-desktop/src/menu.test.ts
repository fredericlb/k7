// What is LEFT of the menu once every control moved to `/@settings`. The rules that used to
// live here — the safety rule, the audio "preferred" gap, SHOW_UI_SEP — moved WITH the screen
// and are tested beside it, in apps/st0/frontend/src/settings/rules.test.ts. What stays here is
// the two lines the icon still carries and the one row that opens the app.

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
  server: null,
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

describe("what the icon still carries", () => {
  it("opens the app first, and with no engine — starting a project is how you get one", () => {
    const t = buildTemplate(view(), () => {});
    expect(t[0]?.id).toBe("open_window");
    expect(byId(t, "open_window")?.enabled).toBe(true);
  });

  it("offers the settings page rather than the settings", () => {
    expect(
      byId(
        buildTemplate(view(), () => {}),
        "settings",
      )?.enabled,
    ).toBe(true);
  });

  it("still says whether there is an engine, which is why the icon is there at all", () => {
    expect(
      byId(
        buildTemplate(view(RUN), () => {}),
        "status",
      )?.label,
    ).toContain("Running");
  });

  it("carries no engine control any more — those have a page with room to explain", () => {
    const t = buildTemplate(view(RUN), () => {});
    for (const gone of [
      "start",
      "stop",
      "restart",
      "restart_file",
      "clear_waveform_cache",
      "rescan",
      "audio",
      "sessions",
      "edit_plugins",
      "weburi",
      "autostart",
      "open_root",
      "open_log",
    ]) {
      expect(byId(t, gone), gone).toBeUndefined();
    }
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
  it("notices the engine coming up, which is the one thing it still draws", () => {
    const off = menuSignature(buildTemplate(view(), () => {}));
    const on = menuSignature(buildTemplate(view(RUN), () => {}));
    expect(off).not.toBe(on);
  });

  it("ignores a session appearing — that is the page's to draw now, not the icon's", () => {
    const base = menuSignature(buildTemplate(view(RUN), () => {}));
    const busy = menuSignature(
      buildTemplate(
        view({
          ...RUN,
          sessions: [
            {
              id: "st0",
              project: "p",
              loaded: true,
              playing: true,
              tracks: 1,
              listeners: 2,
            },
          ],
          webPending: ["https://x.test"],
        }),
        () => {},
      ),
    );
    // A playing session no longer rebuilds the menu at all: it draws none of it.
    expect(busy).toBe(base);
  });
});
