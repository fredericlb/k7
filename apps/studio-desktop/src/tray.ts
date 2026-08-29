// tray.ts — the menu template applied to a real Tray. Two rules make this cheap enough:
// the context menu is rebuilt only when what it SHOWS changed (a rebuild while the menu is
// open closes it, and the playhead moves 20 times a second), and the spinner mutates one
// label in place rather than rebuilding at 8fps. See docs/tray.md.

import type { HostSnapshot } from "@studio/engine-host/hostProtocol";
import { Menu, nativeTheme, Tray } from "electron";
import {
  buildTemplate,
  EMPTY_SNAPSHOT,
  iconStateFor,
  type MenuView,
  menuSignature,
  pluginsLabel,
  tooltip,
} from "./menu.ts";
import { trayImage } from "./trayIcon.ts";

/** Advancing the icon on Linux writes a temp file per call, so there the spinner stays in the menu. */
const ANIMATE_ICON = process.platform !== "linux";

export class StudioTray {
  private tray: Tray | null = null;
  private menu: Menu | null = null;
  private drawn = "";
  private view: MenuView;

  constructor(
    build: string,
    private readonly onClick: (id: string) => void,
  ) {
    this.view = {
      snapshot: EMPTY_SNAPSHOT,
      hostError: null,
      spinner: 0,
      autostart: false,
      build,
    };
  }

  start(): void {
    this.tray = new Tray(this.image());
    // Windows and Linux: a left-click on a tray icon opens the app, and the menu is the RIGHT
    // one. macOS has no such convention — there the menu is the click — so `setContextMenu`
    // already answers and this never fires.
    if (process.platform !== "darwin") {
      this.tray.on("click", () => this.onClick("open_window"));
    }
    this.render();
  }

  /** Replace the supervisor's half wholesale — it arrives whole and nothing here computes it. */
  setSnapshot(snapshot: HostSnapshot): void {
    this.view = { ...this.view, snapshot, hostError: null };
    this.render();
  }

  setHostError(hostError: string | null): void {
    this.view = { ...this.view, hostError };
    this.render();
  }

  setAutostart(autostart: boolean): void {
    this.view = { ...this.view, autostart };
    this.render();
  }

  /** Repaint on a theme change; the appearance is push-based, so there is no poll to run. */
  repaint(): void {
    this.tray?.setImage(this.image());
  }

  /**
   * Advance one frame and repaint ONLY the plugins line and the icon. Rebuilding the menu at
   * this rate would tear down a submenu the user has open, several times a second.
   */
  tick(): void {
    this.view = { ...this.view, spinner: this.view.spinner + 1 };
    if (ANIMATE_ICON) this.tray?.setImage(this.image());
    const item = this.menu?.getMenuItemById("plugins");
    if (item) item.label = pluginsLabel(this.view);
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = null;
  }

  private image() {
    return trayImage(
      iconStateFor(this.view),
      // Read at paint time rather than cached: nativeTheme pushes changes at us.
      nativeTheme.shouldUseDarkColors,
      this.view.snapshot.attention,
    );
  }

  private render(): void {
    if (!this.tray) return;
    this.tray.setImage(this.image());
    this.tray.setToolTip(tooltip(this.view));

    const template = buildTemplate(this.view, this.onClick);
    const sig = menuSignature(template);
    if (sig === this.drawn) return;
    this.drawn = sig;
    this.menu = Menu.buildFromTemplate(template);
    this.tray.setContextMenu(this.menu);
  }
}
