// useModuleEngine.ts — the engine as the module editor needs it: connect to THIS machine's,
// load one module, and report what its plugin's parameters are called and what they span.
// Nothing else — no transport, no meters. See docs/engine.md.

import { EngineClient } from "@studio/engine-browser";
import { probeLocalEngine } from "@studio/engine-browser/probe";
import type { ParamMeta, PresetInfo } from "@studio/engine-protocol";
import { SESSIONS } from "@studio/engine-protocol/sessions";
import { useCallback, useEffect, useRef, useState } from "react";
import { modulePreviewDoc, previewPluginId } from "./preview";

export type EnginePhase =
  | { k: "looking" }
  | { k: "absent" }
  | { k: "ready"; id: string };

export interface ModuleEngine {
  phase: EnginePhase;
  /** Parameter names the loaded plugin reports, or [] before one is loaded. */
  paramNames: string[];
  /** What each spans, so a bound widget adopts the real range instead of a 0..1 guess. */
  paramMeta: Record<string, ParamMeta>;
  /** Factory presets the loaded plugin offers. Empty for a built-in, which has none. */
  presets: PresetInfo[];
  /** Load a module so the engine can answer for it. Safe to call on every edit. */
  preview: (
    module: string,
    plugin: { type?: unknown; name?: unknown } | undefined,
    params?: Record<string, number>,
  ) => void;
  listPresets: (module: string) => void;
  setPreset: (module: string, sel: { index?: number; path?: string }) => void;
  retry: () => void;
}

/**
 * One engine, found on loopback.
 *
 * No registry and no picker, unlike lanes: a module preview must play on the machine the
 * module will be used from, so "which of my engines" has no question to answer here. An
 * absent engine is a normal state — the editor still edits text, it just cannot offer a
 * parameter list.
 */
export function useModuleEngine(): ModuleEngine {
  const [phase, setPhase] = useState<EnginePhase>({ k: "looking" });
  const [paramNames, setParamNames] = useState<string[]>([]);
  const [paramMeta, setParamMeta] = useState<Record<string, ParamMeta>>({});
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const engine = useRef<EngineClient | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  // The module currently loaded, so a reconnect can put it back.
  const loaded = useRef<Parameters<ModuleEngine["preview"]> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPhase({ k: "looking" });
    void (async () => {
      const found = await probeLocalEngine();
      if (cancelled) return;
      if (!found) return setPhase({ k: "absent" });

      // A preview is a one-plugin throwaway project, and it used to be sent to the SAME
      // engine slot lanes had a song in — auditioning a module unloaded the song.
      const client = new EngineClient(
        found.wsUrl,
        undefined,
        SESSIONS.mediatek,
      );
      engine.current = client;
      client.onPluginParams(({ params, meta }) => {
        setParamNames(Object.keys(params));
        if (meta) setParamMeta(meta);
      });
      client.onPresets((_module, list) => setPresets(list));
      client.connect();
      setPhase({ k: "ready", id: found.id });
      // A doc asked for before the socket opened is replayed here rather than lost.
      if (loaded.current) sendPreview(client, ...loaded.current);
    })();
    // No unsubscribe of our own: dispose() drops the client and its callbacks together,
    // and this hook owns the client outright — nobody else holds a reference to it.
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = undefined;
    };
  }, [attempt]);

  const preview = useCallback<ModuleEngine["preview"]>(
    (module, plugin, params) => {
      loaded.current = [module, plugin, params];
      const client = engine.current;
      if (client) sendPreview(client, module, plugin, params);
    },
    [],
  );

  const listPresets = useCallback((module: string) => {
    engine.current?.listPresets(module);
  }, []);

  const setPreset = useCallback<ModuleEngine["setPreset"]>((module, sel) => {
    engine.current?.setPreset(module, sel);
  }, []);

  return {
    phase,
    paramNames,
    paramMeta,
    presets,
    preview,
    listPresets,
    setPreset,
    retry: () => setAttempt((n) => n + 1),
  };
}

/** Apply the one-module doc, then ask what the plugin ended up with. */
function sendPreview(
  client: EngineClient,
  module: string,
  plugin: { type?: unknown; name?: unknown } | undefined,
  params?: Record<string, number>,
): void {
  client.sendProject(modulePreviewDoc(module, plugin, params));
  client.getPluginParams(previewPluginId(module));
}
