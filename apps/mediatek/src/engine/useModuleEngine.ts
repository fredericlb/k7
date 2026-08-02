// useModuleEngine.ts — the engine as the module editor needs it: connect to THIS machine's,
// load one module, and report what its plugin's parameters are called and what they span.
// Nothing else — no transport, no meters. See docs/engine.md.

import { EngineClient } from "@studio/engine-browser";
import { probeLocalEngine } from "@studio/engine-browser/probe";
import type { ParamMeta } from "@studio/engine-protocol";
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
  /** Load a module so the engine can answer for it. Safe to call on every edit. */
  preview: (
    module: string,
    plugin: { type?: unknown; name?: unknown } | undefined,
    params?: Record<string, number>,
  ) => void;
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

      const client = new EngineClient(found.wsUrl);
      engine.current = client;
      const off = client.onPluginParams(({ params, meta }) => {
        setParamNames(Object.keys(params));
        if (meta) setParamMeta(meta);
      });
      client.connect();
      setPhase({ k: "ready", id: found.id });
      // A doc asked for before the socket opened is replayed here rather than lost.
      if (loaded.current) sendPreview(client, ...loaded.current);
      return () => off();
    })();
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

  return {
    phase,
    paramNames,
    paramMeta,
    preview,
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
