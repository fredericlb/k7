// native.ts — the two plugins this app's Kotlin half registers (MainActivity.kt): K7Runtime, the
// supervisor's channel (EnginePlugin.kt), and AppViews, the full-screen WebViews the studio apps
// load in over this page (AppViewsPlugin.kt). Typed here once; nothing else calls registerPlugin.

import { type PluginListenerHandle, registerPlugin } from "@capacitor/core";
import standalone from "../../../../apps/k7/backend/standalone.json";

/** The phone's own backend's ports, as BackendHost.kt starts it: the desktop app's, from the table both share. */
export const LOCAL_PORTS = `k7=${standalone.port}`;

/** One connected studio, as the supervisor lists it. */
export interface StudioInstance {
  url: string;
  removable?: boolean;
}

/** A LAN device asking to pair with this phone's engine; approve only if `code` is what it shows. */
export interface PairRequest {
  requestId: string;
  name: string;
  ip: string;
  code: string;
  since: number;
}

/** A LAN device this engine trusts until it is revoked. */
export interface PairedDevice {
  deviceId: string;
  name: string;
  created: number;
  lastSeen: number;
}

/** The supervisor's `state` frame — what the desktop app reads too. */
export interface SupervisorState {
  status?: string;
  enginePort?: number;
  error?: string;
  instances?: StudioInstance[];
  lastHeartbeatOk?: boolean;
  instanceCheck?: { state?: string; url?: string; message?: string };
  pairRequests?: PairRequest[];
  pairedDevices?: PairedDevice[];
}

interface K7RuntimePlugin {
  /** The latest snapshot and the engine's exit code, whichever are known yet. */
  getState(): Promise<{ state?: SupervisorState; engineExit?: number }>;
  /** One tray command: `weburi.add` / `weburi.remove` with a URL, `pair.approve` / `pair.deny` / `pair.revoke` with an id. */
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

export const K7Runtime = registerPlugin<K7RuntimePlugin>("K7Runtime");

/** The studio apps with a view of their own — the media library and the rehearsal recorder are pages of k7's. */
export type AppId = "k7";
export const APP_IDS: AppId[] = ["k7"];

interface AppViewsPlugin {
  /**
   * Show `id`'s view, creating it on first use. It loads `url` when given, else `apps[id]` when it
   * has nothing loaded yet or its origin changed. `apps` is every app's address: a link from one to
   * another switches view instead (`navigate`). `studio` is the one k7's settings mark as open.
   */
  show(options: {
    id: AppId;
    apps: Record<AppId, string>;
    studio: string;
    url?: string;
  }): Promise<void>;
  /** Back to this page alone: the tray. The views keep running, hidden. */
  hideAll(): Promise<void>;
  reload(options: { id: AppId }): Promise<void>;
  /** A view followed a link to another app: show that one, at that URL. */
  addListener(
    event: "navigate",
    listener: (to: { id: AppId; url: string }) => void,
  ): Promise<PluginListenerHandle>;
  /** k7's settings picked which connected studio the views open. */
  addListener(
    event: "studio",
    listener: (to: { origin: string }) => void,
  ): Promise<PluginListenerHandle>;
  /** A view's page did not load: nothing in it can reach k7's settings, so this page shows. */
  addListener(
    event: "loadError",
    listener: (failed: { id: AppId; message: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const AppViews = registerPlugin<AppViewsPlugin>("AppViews");
