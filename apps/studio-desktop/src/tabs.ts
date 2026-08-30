// tabs.ts — one WebContentsView per open address, and the rule the whole thing rests on:
// only the tab in FRONT holds a project. Switching tells the leaving page to let go before
// it is hidden, so its unload still has a live socket to leave on. See docs/tabs.md.

import { type Rectangle, shell, type View, WebContentsView } from "electron";
import { line } from "./logbus.ts";
import type { TabRow } from "./preload.ts";

interface Tab {
  id: number;
  view: WebContentsView;
  /** The home tab: it cannot be closed, and it never leaves home — see docs/tabs.md. */
  home: boolean;
}

export class TabSet {
  private readonly tabs: Tab[] = [];
  private active = 0;
  private next = 1;
  private bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  constructor(
    private readonly parent: View,
    private readonly preload: string,
    /** Called whenever the strip's picture changes — its rows, or which one is lit. */
    private readonly onChanged: () => void,
  ) {}

  open(url: string, opts: { home?: boolean } = {}): number {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preload,
        // Not the default, and per VIEW rather than per window — see docs/window.md.
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // A link out opens in the user's BROWSER, not in a tab with no address bar (RFC 8252 §8.12).
    view.webContents.setWindowOpenHandler(({ url: target }) => {
      void shell.openExternal(target);
      return { action: "deny" };
    });
    const id = this.next++;
    // The strip draws a title and an address, and both move as the page navigates.
    const changed = () => this.onChanged();
    view.webContents.on("page-title-updated", changed);
    view.webContents.on("did-navigate", changed);
    view.webContents.on("did-navigate-in-page", changed);
    // Re-told on every load: a page reloaded while hidden would else take its project back.
    view.webContents.on("did-finish-load", () =>
      this.tell(id, id === this.active),
    );
    const home = opts.home === true;
    if (home) this.pinHome(view, url);
    this.tabs.push({ id, view, home });
    this.parent.addChildView(view);
    // Not the promise alone: a navigation that reaches the server and is REFUSED there
    // rejects nothing, and the tab is simply blank — an aborted load (-3) is not a failure.
    view.webContents.on("did-fail-load", (_e, code, why, at) => {
      if (code !== -3) line("host", `tab ${id} failed to load ${at}: ${why}`);
    });
    view.webContents.loadURL(url).catch((e: unknown) => {
      line("host", `tab ${id} could not load ${url}: ${String(e)}`);
    });
    this.select(id);
    return id;
  }

  select(id: number): void {
    if (!this.tabs.some((t) => t.id === id)) return;
    const leaving = this.active;
    if (leaving === id) return;
    this.active = id;
    // Told BEFORE the layout hides it, so the unload leaves on a live socket — docs/tabs.md.
    if (leaving) this.tell(leaving, false);
    this.tell(id, true);
    this.layout();
    this.onChanged();
  }

  close(id: number): void {
    const i = this.tabs.findIndex((t) => t.id === id);
    // Refused here too, so the missing close button is a RULE and not just a missing control.
    if (i < 0 || this.tabs[i].home) return;
    const [gone] = this.tabs.splice(i, 1);
    this.parent.removeChildView(gone.view);
    // Not just detached: a view left behind holds its renderer for the life of the app.
    gone.view.webContents.close();
    if (this.active === id) {
      this.active = 0;
      // The one to its right, else the one to its left — what every tabbed thing does.
      const heir = this.tabs[i] ?? this.tabs[i - 1];
      if (heir) this.select(heir.id);
    }
    this.layout();
    this.onChanged();
  }

  count(): number {
    return this.tabs.length;
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

  /** Push the strip's picture to one page — the strip's own view, which is not a tab. */
  pushTo(view: WebContentsView): void {
    view.webContents.send("studio:tabs", this.list());
  }

  destroy(): void {
    for (const t of this.tabs) {
      this.parent.removeChildView(t.view);
      t.view.webContents.close();
    }
    this.tabs.length = 0;
    this.active = 0;
  }

  /** The home tab never leaves home: what it would open, opens beside it — docs/tabs.md. */
  private pinHome(view: WebContentsView, homeUrl: string): void {
    const base = new URL(homeUrl);
    view.webContents.on("will-navigate", (e, target) => {
      let to: URL;
      try {
        to = new URL(target);
      } catch {
        return; // not an address we can reason about; let it through
      }
      // Home itself, reloaded or with a query — that is not leaving.
      if (to.origin === base.origin && to.pathname === base.pathname) return;
      e.preventDefault();
      // Another origin is the BROWSER's business, the same rule a new window follows.
      if (to.origin !== base.origin) {
        void shell.openExternal(target);
        return;
      }
      line("host", `home → new tab: ${to.pathname}`);
      this.open(target);
    });
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
