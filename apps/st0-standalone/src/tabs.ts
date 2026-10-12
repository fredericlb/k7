// tabs.ts — one WebContentsView per tab: the home tab, pinned, and one per open project. Only the tab in FRONT holds its project.
// Switching tells the leaving page before it is hidden, so its unload still has a live socket to leave on. See docs/tabs.md.

import { line } from "@frediverse/electron-shell/log";
import {
  type Rectangle,
  shell,
  type View,
  WebContentsView,
  type WebPreferences,
} from "electron";
import type { TabRow } from "./preload.ts";
import { type Destination, destination, projectKey } from "./routing.ts";

interface Tab {
  id: number;
  view: WebContentsView;
  /** The home tab: never closed, never leaves home. */
  home: boolean;
  /** The project it holds, so a second link to it selects this tab rather than opening another. */
  key: string | null;
}

export interface TabSetSpec {
  /** Where the tabs are drawn. */
  parent: View;
  /** The app's origin: anything else opens in the system browser. */
  origin: string;
  webPreferences: WebPreferences;
  /** The window's icon, given to the windows a page opens. */
  icon?: string;
  /** Called whenever the strip's picture changes — its rows, or which one is lit. */
  onChanged: () => void;
  /** A page asked to sign in: that happens in the system browser, never in a tab. */
  onSignIn: () => void;
}

export class TabSet {
  private readonly tabs: Tab[] = [];
  private active = 0;
  private next = 1;
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private readonly spec: TabSetSpec) {}

  /** The pinned first tab; `url` may be a sign-in that comes back home. */
  openHome(url: string): void {
    this.open(url, null, true);
  }

  /** Bring the project's tab forward, opening it first if no tab holds it. */
  openProject(url: string, key: string): void {
    const held = this.tabs.find((t) => t.key === key);
    if (held) this.select(held.id);
    else this.open(url, key, false);
  }

  select(id: number): void {
    const leaving = this.active;
    if (leaving === id || !this.tabs.some((t) => t.id === id)) return;
    this.active = id;
    // Told BEFORE the layout hides it, so the unload leaves on a live socket.
    if (leaving) this.tell(leaving, false);
    this.tell(id, true);
    this.layout();
    this.spec.onChanged();
  }

  close(id: number): void {
    const i = this.tabs.findIndex((t) => t.id === id);
    // Refused here too, so the missing close button is a rule and not just a missing control.
    if (i < 0 || this.tabs[i].home) return;
    const [gone] = this.tabs.splice(i, 1);
    if (this.active === id) {
      // The one to its right, else the one to its left — what every tabbed thing does.
      const heir = this.tabs[i] ?? this.tabs[i - 1];
      if (heir) this.select(heir.id);
    }
    this.spec.parent.removeChildView(gone.view);
    // Not just detached: a view left behind holds its renderer for the life of the app.
    gone.view.webContents.close();
    this.spec.onChanged();
  }

  /** Another account: every project tab goes, since what it holds was the last account's, and home loads `url`. */
  reset(url: string): void {
    for (const t of this.tabs.filter((x) => !x.home)) this.close(t.id);
    const home = this.tabs.find((t) => t.home);
    if (!home) return;
    void home.view.webContents.loadURL(url);
    this.select(home.id);
  }

  /** Cycle through the tabs, `step` 1 or -1. */
  cycle(step: number): void {
    const i = this.tabs.findIndex((t) => t.id === this.active);
    if (i < 0) return;
    const n = this.tabs.length;
    this.select(this.tabs[(i + step + n) % n].id);
  }

  closeActive(): void {
    this.close(this.active);
  }

  setBounds(b: Rectangle): void {
    this.bounds = b;
    this.layout();
  }

  list(): TabRow[] {
    return this.tabs.map((t) => ({
      id: t.id,
      url: t.view.webContents.getURL(),
      title: t.view.webContents.getTitle(),
      active: t.id === this.active,
      home: t.home,
    }));
  }

  destroy(): void {
    for (const t of this.tabs) {
      this.spec.parent.removeChildView(t.view);
      t.view.webContents.close();
    }
    this.tabs.length = 0;
    this.active = 0;
  }

  private open(url: string, key: string | null, home: boolean): void {
    const view = new WebContentsView({
      // A throttled renderer stops the playhead of the project in front.
      webPreferences: {
        ...this.spec.webPreferences,
        backgroundThrottling: false,
      },
    });
    const tab: Tab = { id: this.next++, view, home, key };
    const wc = view.webContents;
    this.route(tab);
    const changed = () => this.spec.onChanged();
    wc.on("page-title-updated", changed);
    wc.on("did-navigate-in-page", changed);
    wc.on("did-navigate", (_e, at) => {
      if (!tab.home) tab.key = projectKey(new URL(at).pathname) ?? tab.key;
      changed();
    });
    // Re-told on every load: a page reloaded while hidden would else take its project back.
    wc.on("did-finish-load", () => this.tell(tab.id, tab.id === this.active));
    // An aborted load (-3) is a navigation we cancelled, not a failure.
    wc.on("did-fail-load", (_e, code, why, at) => {
      if (code !== -3)
        line("app", `tab ${tab.id} failed to load ${at}: ${why}`);
    });
    this.tabs.push(tab);
    this.spec.parent.addChildView(view);
    wc.loadURL(url).catch((e: unknown) => {
      line("app", `tab ${tab.id} could not load ${url}: ${String(e)}`);
    });
    this.select(tab.id);
  }

  /** What a tab's navigations and `window.open`s turn into — the table in docs/tabs.md. */
  private route(tab: Tab): void {
    const wc = tab.view.webContents;
    const { origin, webPreferences, icon } = this.spec;
    wc.on("will-navigate", (e, url) => {
      const d = destination(url, origin);
      if (this.stays(tab, d)) return;
      e.preventDefault();
      this.send(url, d);
    });
    // A server redirect skips will-navigate: one leaving the app is the IdP's page, which a tab must not show.
    wc.on("will-redirect", (e, url) => {
      if (destination(url, origin).to !== "browser") return;
      e.preventDefault();
      void shell.openExternal(url);
    });
    wc.setWindowOpenHandler(({ url }) => {
      const d = destination(url, origin);
      if (d.to === "window" || d.to === "inPlace")
        return {
          action: "allow",
          overrideBrowserWindowOptions: { webPreferences },
        };
      this.send(url, d);
      return { action: "deny" };
    });
    if (icon) wc.on("did-create-window", (child) => child.setIcon(icon));
    // Taken before the menu sees it: the menu's Close Window would quit the whole app.
    wc.on("before-input-event", (e, input) => {
      if (input.type !== "keyDown") return;
      const mod = process.platform === "darwin" ? input.meta : input.control;
      if (mod && !input.shift && input.key.toLowerCase() === "w") {
        e.preventDefault();
        this.closeActive();
      } else if (input.control && input.key === "Tab") {
        e.preventDefault();
        this.cycle(input.shift ? -1 : 1);
      }
    });
  }

  /** Whether a navigation of `tab` to `d` stays in it. */
  private stays(tab: Tab, d: Destination): boolean {
    if (d.to === "inPlace") return true;
    if (d.to === "home") return tab.home;
    // A reload, or another view of the same project.
    if (d.to === "project") return !tab.home && d.key === tab.key;
    return false;
  }

  private send(url: string, d: Destination): void {
    if (d.to === "browser") {
      void shell.openExternal(url);
      return;
    }
    if (d.to === "signIn") {
      this.spec.onSignIn();
      return;
    }
    if (d.to === "home") {
      const home = this.tabs.find((t) => t.home);
      if (!home) return;
      if (home.view.webContents.getURL() !== url)
        void home.view.webContents.loadURL(url);
      this.select(home.id);
      return;
    }
    // A surface reached by a plain link gets a tab of its own, keyed by its whole address.
    const key = d.to === "project" ? d.key : new URL(url).pathname;
    this.openProject(url, key);
  }

  private tell(id: number, active: boolean): void {
    const t = this.tabs.find((x) => x.id === id);
    t?.view.webContents.send("studio:tab", { active });
  }

  /** Only the tab in front is laid out; the rest are hidden rather than moved off-screen. */
  private layout(): void {
    for (const t of this.tabs) {
      const front = t.id === this.active;
      t.view.setVisible(front);
      if (front) t.view.setBounds(this.bounds);
    }
  }
}
