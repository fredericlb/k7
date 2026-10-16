// enginePluginQueries.ts — what this machine's engine says about ONE plugin, asked on the bare session:
// its parameters, its own window, a snapshot of its state. Each answer is matched on the id it was
// asked for, since another surface may be asking at once. See docs/activeProject.md.

import type { PluginParamInfo } from "@studio/engine-client/engineClient";
import { ensureEngine } from "./engineSessions.ts";

/** How long the engine gets to LOAD a plugin and list its parameters — see docs/activeProject.md. */
export const PLUGIN_PARAMS_TIMEOUT_MS = 20_000;

/** The slice of EngineClient this needs, so the wait can be tested without a socket. */
export interface PluginParamListingClient {
  on(event: "pluginParamList", fn: (p: PluginParamFrame) => void): unknown;
  off(event: "pluginParamList", fn: (p: PluginParamFrame) => void): unknown;
  listPluginParams(format: string, id: string): void;
}
interface PluginParamFrame {
  format: string;
  id: string;
  /** Whether the machine could LOAD it — see `PluginParamAnswer.found`. */
  found?: boolean;
  params: PluginParamInfo[];
}

/** What one plugin answered — THREE outcomes, not two. See docs/activeProject.md. */
export interface PluginParamAnswer {
  found: boolean;
  params: PluginParamInfo[];
}

/** Ask what one plugin's parameters are, MATCHED ON THE ID — `undefined` = silence, docs/activeProject.md. */
export function awaitPluginParams(
  c: PluginParamListingClient,
  format: string,
  id: string,
  timeoutMs: number = PLUGIN_PARAMS_TIMEOUT_MS,
): Promise<PluginParamAnswer | undefined> {
  return new Promise((res) => {
    const done = (v?: PluginParamAnswer): void => {
      clearTimeout(timer);
      c.off("pluginParamList", onList);
      res(v);
    };
    const onList = (p: PluginParamFrame): void => {
      if (p.id !== id) return; // another surface's question, not the answer to this one
      // An engine too old to send the flag loaded SOMETHING to answer at all, so absent reads as true.
      done({ found: p.found !== false, params: p.params });
    };
    const timer = setTimeout(() => done(undefined), timeoutMs);
    c.on("pluginParamList", onList);
    c.listPluginParams(format, id);
  });
}

/** …asked of THIS machine's engine, on the bare session — see docs/activeProject.md. */
export async function pluginParams(
  format: string,
  id: string,
): Promise<PluginParamAnswer | undefined> {
  const c = ensureEngine(null);
  // No `isReady` check here, deliberately: `send` buffers, and that is what makes the first click work.
  if (!c) return undefined;
  return awaitPluginParams(c, format, id);
}

/** How long the engine gets to open the window — generous, because a cold load is. See docs/activeProject.md. */
export const NATIVE_UI_TIMEOUT_MS = 30_000;

interface NativeUiFrame {
  format: string;
  id: string;
  ok: boolean;
}

/** Open the plugin's own WINDOW on an orphan instance, and AWAIT the engine — docs/activeProject.md. */
export async function showNativePluginUIOf(
  format: string,
  id: string,
): Promise<{ ok: boolean } | undefined> {
  const c = ensureEngine(null);
  if (!c) return undefined;
  return new Promise((res) => {
    const done = (v?: { ok: boolean }): void => {
      clearTimeout(timer);
      c.off("nativePluginUiOpened", onOpened);
      res(v);
    };
    const onOpened = (p: NativeUiFrame): void => {
      if (p.id !== id) return; // another surface's window, not this one
      done({ ok: p.ok });
    };
    const timer = setTimeout(() => done(undefined), NATIVE_UI_TIMEOUT_MS);
    c.on("nativePluginUiOpened", onOpened);
    c.showNativePluginUIOf(format, id);
  });
}

/** How long the engine gets to write a base. Short: nothing is LOADED here, the instance is open. */
export const PLUGIN_BASE_TIMEOUT_MS = 5_000;

interface PluginBaseFrame {
  path: string;
  ok: boolean;
}

/** Snapshot the orphan's state into `absPath`, and wait to hear whether it landed — docs/activeProject.md. */
export async function snapshotPluginBase(
  format: string,
  id: string,
  absPath: string,
): Promise<{ ok: boolean } | undefined> {
  const c = ensureEngine(null);
  if (!c) return undefined;
  return new Promise((res) => {
    const done = (v?: { ok: boolean }): void => {
      clearTimeout(timer);
      c.off("pluginBaseSaved", onSaved);
      res(v);
    };
    const onSaved = (p: PluginBaseFrame): void => {
      if (p.path !== absPath) return; // another surface's snapshot, not this one
      done({ ok: p.ok });
    };
    const timer = setTimeout(() => done(undefined), PLUGIN_BASE_TIMEOUT_MS);
    c.on("pluginBaseSaved", onSaved);
    c.snapshotPluginBase(format, id, absPath);
  });
}
