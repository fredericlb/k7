// menuTemplate.ts — the application menu as data, for a platform and a packaged or checkout run. Pure, so it is tested.
// The window is a BaseWindow of views: a role that reaches `window.webContents` finds none, so those are clicks here. See docs/menu.md.

import type { MenuItemConstructorOptions } from "electron";

/** What a page does on an Edit or View item: run on the page that has the focus. */
export type PageCommand =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "selectAll"
  | "resetZoom"
  | "zoomIn"
  | "zoomOut"
  | "reload"
  | "forceReload"
  | "toggleDevTools";

export interface MenuActions {
  /** The About panel, filled with the release stamp (menu.ts). */
  about: () => void;
  /** k7's `/settings`, in the home tab. */
  settings: () => void;
  closeTab: () => void;
  closeWindow: () => void;
  toggleFullscreen: () => void;
  page: (cmd: PageCommand) => void;
  /** k7's `/docs`, in the home tab. */
  docs: () => void;
  openLogs: () => void;
  checkUpdates: () => void;
  /** The automatic update check's checkbox. */
  autoCheck: { on: boolean; set: (on: boolean) => void };
}

export function menuTemplate(
  platform: NodeJS.Platform,
  isPackaged: boolean,
  a: MenuActions,
): MenuItemConstructorOptions[] {
  const mac = platform === "darwin";
  const sep: MenuItemConstructorOptions = { type: "separator" };
  // macOS sends the Edit commands down the responder chain, which reaches the focused view; elsewhere they go to the page.
  const edit = (
    role: PageCommand & MenuItemConstructorOptions["role"],
    label: string,
    accelerator?: string,
  ): MenuItemConstructorOptions =>
    mac ? { role } : { label, accelerator, click: () => a.page(role) };
  const page = (
    cmd: PageCommand,
    label: string,
    accelerator: string,
  ): MenuItemConstructorOptions => ({
    label,
    accelerator,
    click: () => a.page(cmd),
  });
  const updates: MenuItemConstructorOptions[] = [
    { label: "Check for Updates…", click: a.checkUpdates },
    {
      label: "Check for Updates Automatically",
      type: "checkbox",
      checked: a.autoCheck.on,
      click: (item) => a.autoCheck.set(item.checked),
    },
  ];
  const settings: MenuItemConstructorOptions = {
    label: mac ? "Settings…" : "Settings",
    accelerator: "CmdOrCtrl+,",
    click: a.settings,
  };
  const closing: MenuItemConstructorOptions[] = [
    { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: a.closeTab },
    {
      label: "Close Window",
      accelerator: "CmdOrCtrl+Shift+W",
      click: a.closeWindow,
    },
  ];

  const appMenu: MenuItemConstructorOptions = {
    label: "k7",
    submenu: [
      { label: "About k7", click: a.about },
      ...updates,
      sep,
      settings,
      sep,
      { role: "services" },
      sep,
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      sep,
      { role: "quit" },
    ],
  };
  const file: MenuItemConstructorOptions = {
    label: "File",
    submenu: mac ? closing : [settings, sep, ...closing, sep, { role: "quit" }],
  };
  const editMenu: MenuItemConstructorOptions = {
    label: "Edit",
    submenu: [
      edit("undo", "Undo", "CmdOrCtrl+Z"),
      edit("redo", "Redo", mac ? "Shift+Cmd+Z" : "Ctrl+Y"),
      sep,
      edit("cut", "Cut", "CmdOrCtrl+X"),
      edit("copy", "Copy", "CmdOrCtrl+C"),
      edit("paste", "Paste", "CmdOrCtrl+V"),
      // No key: a page's own Delete (a clip, a node) must not become a text delete.
      edit("delete", "Delete"),
      edit("selectAll", "Select All", "CmdOrCtrl+A"),
    ],
  };
  const view: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      // A reload drops what a page holds unsaved, and the inspector is a developer's: neither ships.
      ...(isPackaged
        ? []
        : [
            page("reload", "Reload", "CmdOrCtrl+R"),
            page("forceReload", "Force Reload", "CmdOrCtrl+Shift+R"),
            page(
              "toggleDevTools",
              "Toggle Developer Tools",
              mac ? "Alt+Cmd+I" : "Ctrl+Shift+I",
            ),
            sep,
          ]),
      page("resetZoom", "Actual Size", "CmdOrCtrl+0"),
      page("zoomIn", "Zoom In", "CmdOrCtrl+="),
      page("zoomOut", "Zoom Out", "CmdOrCtrl+-"),
      sep,
      {
        label: "Toggle Full Screen",
        accelerator: mac ? "Ctrl+Cmd+F" : "F11",
        click: a.toggleFullscreen,
      },
    ],
  };
  const windowMenu: MenuItemConstructorOptions = {
    role: "windowMenu",
    submenu: mac
      ? [{ role: "minimize" }, { role: "zoom" }, sep, { role: "front" }]
      : [{ role: "minimize" }],
  };
  const help: MenuItemConstructorOptions = {
    role: "help",
    submenu: [
      { label: "k7 Documentation", click: a.docs },
      { label: "Open Log Folder", click: a.openLogs },
      ...(mac
        ? []
        : [sep, ...updates, sep, { label: "About k7", click: a.about }]),
    ],
  };
  return [...(mac ? [appMenu] : []), file, editMenu, view, windowMenu, help];
}
