// The two encodings that fail quietly: a plugin row carries SHOW_UI_SEP and must cross
// verbatim, and `fb:` with nothing after it is an empty arg that MEANS "no fallback" — read
// as "not present" it would leave the fallback where it was and look like a click that missed.

import { SHOW_UI_SEP } from "@studio/engine-host/hostProtocol";
import { describe, expect, it } from "vitest";
import { routeMenuId } from "./route.ts";

describe("routing a menu click", () => {
  it("sends one restart command, not stop-then-start", () => {
    expect(routeMenuId("restart")).toEqual({
      kind: "command",
      cmd: "engine.restart",
    });
  });

  it("maps the plain rows to their commands", () => {
    expect(routeMenuId("start")).toEqual({
      kind: "command",
      cmd: "engine.start",
    });
    expect(routeMenuId("stop")).toEqual({
      kind: "command",
      cmd: "engine.stop",
    });
    expect(routeMenuId("restart_file")).toEqual({
      kind: "command",
      cmd: "fileService.restart",
    });
    expect(routeMenuId("clear_waveform_cache")).toEqual({
      kind: "command",
      cmd: "waveforms.clear",
    });
    expect(routeMenuId("rescan")).toEqual({
      kind: "command",
      cmd: "plugins.rescan",
    });
  });

  it("forwards a plugin row's session and id VERBATIM, separator included", () => {
    expect(routeMenuId(`plugin_open:st0${SHOW_UI_SEP}node-7`)).toEqual({
      kind: "command",
      cmd: "plugin.showUI",
      arg: `st0${SHOW_UI_SEP}node-7`,
    });
  });

  it("treats `fb:` as the empty arg that means none", () => {
    expect(routeMenuId("fb:")).toEqual({
      kind: "command",
      cmd: "audio.fallback",
      arg: "",
    });
    expect(routeMenuId("fb:Scarlett")).toEqual({
      kind: "command",
      cmd: "audio.fallback",
      arg: "Scarlett",
    });
  });

  it("keeps a device name whole, colons and all", () => {
    expect(routeMenuId("dev:MOTU: UltraLite")).toEqual({
      kind: "command",
      cmd: "audio.select",
      arg: "MOTU: UltraLite",
    });
  });

  it("keeps an origin whole, scheme and port included", () => {
    expect(routeMenuId("weburi_del:https://daw.test:8443")).toEqual({
      kind: "command",
      cmd: "weburi.remove",
      arg: "https://daw.test:8443",
    });
    expect(routeMenuId("weburi_allow:https://x.test")).toEqual({
      kind: "command",
      cmd: "weburi.allow",
      arg: "https://x.test",
    });
    expect(routeMenuId("weburi_deny:https://x.test")).toEqual({
      kind: "command",
      cmd: "weburi.deny",
      arg: "https://x.test",
    });
  });

  it("drops the default session by its empty id rather than skipping it", () => {
    expect(routeMenuId("session_drop:")).toEqual({
      kind: "command",
      cmd: "session.drop",
      arg: "",
    });
  });

  it("keeps the rows this app does itself out of the supervisor's hands", () => {
    expect(routeMenuId("open_window")).toEqual({
      kind: "local",
      what: "openWindow",
    });
    expect(routeMenuId("autostart")).toEqual({
      kind: "local",
      what: "autostart",
    });
    expect(routeMenuId("open_root")).toEqual({
      kind: "local",
      what: "openRoot",
    });
    expect(routeMenuId("open_log")).toEqual({ kind: "local", what: "openLog" });
    expect(routeMenuId("weburi_add")).toEqual({
      kind: "local",
      what: "addWebUi",
    });
    expect(routeMenuId("quit")).toEqual({ kind: "local", what: "quit" });
  });

  it("ignores the rows that are not clicks — a status line, a placeholder", () => {
    for (const id of [
      "status",
      "registry",
      "plugins",
      "build",
      "sessions_none",
      "dev_missing",
    ]) {
      expect(routeMenuId(id)).toBeNull();
    }
  });
});
