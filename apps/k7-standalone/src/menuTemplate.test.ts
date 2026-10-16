import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { type MenuActions, menuTemplate } from "./menuTemplate.ts";

const actions = (): MenuActions => ({
  about: vi.fn(),
  settings: vi.fn(),
  closeTab: vi.fn(),
  closeWindow: vi.fn(),
  toggleFullscreen: vi.fn(),
  page: vi.fn(),
  docs: vi.fn(),
  openLogs: vi.fn(),
  checkUpdates: vi.fn(),
  autoCheck: { on: true, set: vi.fn() },
});

/** Every item, submenus flattened. */
function all(
  items: MenuItemConstructorOptions[],
): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [
    i,
    ...(Array.isArray(i.submenu)
      ? all(i.submenu as MenuItemConstructorOptions[])
      : []),
  ]);
}
const byLabel = (items: MenuItemConstructorOptions[], label: string) =>
  all(items).find((i) => i.label === label);

describe("the application menu", () => {
  it("has macOS's app menu first, and no such menu elsewhere", () => {
    expect(menuTemplate("darwin", true, actions())[0].label).toBe("k7");
    expect(menuTemplate("win32", true, actions())[0].label).toBe("File");
    expect(
      menuTemplate("linux", true, actions()).map((m) => m.label ?? m.role),
    ).toEqual(["File", "Edit", "View", "windowMenu", "help"]);
  });

  it("closes a tab on Cmd/Ctrl+W and the window only with Shift", () => {
    for (const p of ["darwin", "win32"] as const) {
      const a = actions();
      const t = menuTemplate(p, true, a);
      expect(byLabel(t, "Close Tab")?.accelerator).toBe("CmdOrCtrl+W");
      expect(byLabel(t, "Close Window")?.accelerator).toBe("CmdOrCtrl+Shift+W");
      byLabel(t, "Close Tab")?.click?.({} as never, undefined, {} as never);
      expect(a.closeTab).toHaveBeenCalled();
    }
  });

  it("opens Settings on Cmd/Ctrl+comma, and About from the app menu or Help", () => {
    const mac = menuTemplate("darwin", true, actions());
    expect(byLabel(mac, "Settings…")?.accelerator).toBe("CmdOrCtrl+,");
    expect(byLabel(mac, "About k7")).toBeDefined();
    const win = menuTemplate("win32", true, actions());
    expect(byLabel(win, "Settings")?.accelerator).toBe("CmdOrCtrl+,");
    expect(byLabel(win, "About k7")).toBeDefined();
  });

  it("ships no reload and no inspector", () => {
    const labels = (p: boolean) =>
      all(menuTemplate("darwin", p, actions())).map((i) => i.label);
    expect(labels(true)).not.toContain("Reload");
    expect(labels(true)).not.toContain("Toggle Developer Tools");
    expect(labels(false)).toContain("Reload");
    expect(labels(false)).toContain("Toggle Developer Tools");
  });

  it("leaves Edit to macOS's roles, and sends it to the page elsewhere", () => {
    const mac = all(menuTemplate("darwin", true, actions()));
    expect(
      mac.filter((i) => i.role === "copy" || i.role === "paste"),
    ).toHaveLength(2);
    const a = actions();
    const win = menuTemplate("win32", true, a);
    byLabel(win, "Copy")?.click?.({} as never, undefined, {} as never);
    expect(a.page).toHaveBeenCalledWith("copy");
  });

  it("keeps the update checkbox's state", () => {
    const a = actions();
    a.autoCheck.on = false;
    expect(
      byLabel(
        menuTemplate("darwin", true, a),
        "Check for Updates Automatically",
      )?.checked,
    ).toBe(false);
  });
});
