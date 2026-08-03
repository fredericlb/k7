// useModuleEngine.ts — the engine as the module editor needs it: connect to the one this
// ACCOUNT chose, load one module, and report what its plugin's parameters are called and
// what they span. Nothing else — no transport, no meters. See docs/engine.md.

import { EngineClient } from "@studio/engine-browser";
import { probeEngines } from "@studio/engine-browser/probe";
import type { ParamMeta, PresetInfo } from "@studio/engine-protocol";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import type { PublicEngine } from "@studio/web-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentUser, engines } from "../api";
import { chooseEngine } from "./chooseEngine";
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
 * The engine this ACCOUNT auditions modules through.
 *
 * It used to be loopback and nothing else, on the argument that a preview must play on the
 * machine the module will be used from — so "which of my engines" had no question to
 * answer. That was true while a person had one machine. Now the médiathèque holds its own
 * registry, the choice is remembered on the account, and the policy lives in
 * `chooseEngine` where it can be tested.
 *
 * An absent engine is still a normal state: the editor edits text either way, it just
 * cannot offer a parameter list.
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
      // Both at once: a remembered id is only a hint that still has to be probed, so
      // waiting for one before starting the other would add a round trip to every load.
      const [list, prefs] = await Promise.all([
        engines.list().catch(() => [] as PublicEngine[]),
        engines.prefs().catch(() => ({}) as { engineId?: string }),
      ]);
      if (cancelled) return;
      const ranked = await probeEngines(list);
      if (cancelled) return;
      // The picker lives in the médiathèque's header, which this screen REPLACES — so a
      // choice can never change while the editor is open, and this only has to honour it.
      const choice = chooseEngine(ranked, prefs.engineId);
      if (!choice.engine) return setPhase({ k: "absent" });
      const found = choice.engine;
      // The lease, exactly as lanes takes it — and a miss is not fatal: it marks the engine
      // in use, it does not grant the connection, which the browser makes itself.
      engines.select(found.engine.id, found.token!, found.tier).catch(() => {});

      // A preview is a one-plugin throwaway project, and it used to be sent to the SAME
      // engine slot lanes had a song in — auditioning a module unloaded the song.
      // Per SERVICE and per PERSON: the médiathèque is hosted, so two people can choose the
      // same machine, and on a bare "mediatek" one of them auditioning a module would tear
      // down the other's preview mid-listen.
      const client = new EngineClient(
        found.wsUrl!,
        undefined,
        sessionFor(SESSIONS.mediatek, currentUser()),
      );
      engine.current = client;
      client.onPluginParams(({ params, meta }) => {
        setParamNames(Object.keys(params));
        if (meta) setParamMeta(meta);
      });
      client.onPresets((_module, list) => setPresets(list));
      client.connect();
      setPhase({ k: "ready", id: found.engine.id });
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
