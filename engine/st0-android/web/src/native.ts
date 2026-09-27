// native.ts — the two plugins this app's Kotlin half registers (MainActivity.kt): St0Engine, the
// supervisor's channel (EnginePlugin.kt), and AppViews, the WebViews the studio apps load in under
// the header (AppViewsPlugin.kt). Typed here once; nothing else calls registerPlugin.

import { type PluginListenerHandle, registerPlugin } from "@capacitor/core";

/** One connected studio, as the supervisor lists it. */
export interface StudioInstance {
  url: string;
  removable?: boolean;
}

/** The supervisor's `state` frame — what the desktop tray draws too. */
export interface SupervisorState {
  status?: string;
  enginePort?: number;
  error?: string;
  instances?: StudioInstance[];
  lastHeartbeatOk?: boolean;
  instanceCheck?: { state?: string; url?: string; message?: string };
}

interface St0EnginePlugin {
  /** The latest snapshot and the engine's exit code, whichever are known yet. */
  getState(): Promise<{ state?: SupervisorState; engineExit?: number }>;
  /** One tray command: `weburi.add` / `weburi.remove` with a URL. */
  command(options: { cmd: string; arg?: string }): Promise<void>;
  /** The active network's IPv4 — what a browser on the LAN dials. */
  lanAddress(): Promise<{ address?: string }>;
  /** How many CAs are trusted beyond Android's. */
  casInfo(): Promise<{ count: number }>;
  /** Pick a certificate file and trust it; resolves once the supervisor has restarted with it. */
  importCa(): Promise<{ said: string; count: number }>;
  /** Trust Android's CAs only again; resolves once the supervisor has restarted. */
  forgetCas(): Promise<{ count: number }>;
  /** Leave the app, which stops the supervisor and the engine. */
  quit(): Promise<void>;
  addListener(
    event: "state",
    listener: (state: SupervisorState) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "engineExit",
    listener: (exit: { code: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export const St0Engine = registerPlugin<St0EnginePlugin>("St0Engine");

/** The studio apps with a tab of their own. */
export type AppId = "st0" | "pl8" | "k7";
export const APP_IDS: AppId[] = ["st0", "pl8", "k7"];

interface AppViewsPlugin {
  /**
   * Show `id`'s view, `top` CSS px below the top of the screen, creating it on first use. It loads
   * `url` when given, else `apps[id]` when it has nothing loaded yet or its origin changed.
   * `apps` is every app's address: a link from one to another switches tab instead (`navigate`).
   */
  show(options: {
    id: AppId;
    top: number;
    apps: Record<AppId, string>;
    url?: string;
  }): Promise<void>;
  /** Back to this page alone: the engine tab. The views keep running, hidden. */
  hideAll(): Promise<void>;
  /** The header's height changed. */
  setTop(options: { top: number }): Promise<void>;
  reload(options: { id: AppId }): Promise<void>;
  /** A view followed a link to another app: switch to that tab, at that URL. */
  addListener(
    event: "navigate",
    listener: (to: { id: AppId; url: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const AppViews = registerPlugin<AppViewsPlugin>("AppViews");
