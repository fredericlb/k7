// useModuleEngine.ts — the engine as the module editor needs it: connect to the one this
// ACCOUNT chose, load one module, and report what its plugin's parameters are called and
// what they span. Nothing else — no transport, no meters. See docs/engine.md.

import { EngineClient } from "@studio/engine-browser";
import { chooseEngine } from "@studio/engine-browser/choose";
import { probeEngines } from "@studio/engine-browser/probe";
import type { ParamMeta, PresetInfo } from "@studio/engine-protocol";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import {
  ENGINE_ASSIGN_RENEW_MS,
  type PublicEngine,
} from "@studio/web-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentUser, engines } from "../api";
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
 *
 * `engineId` is the account's current pick, handed down by whoever draws the picker. It used
 * to be read here and only here, because the editor REPLACED the screen the picker lives on
 * and a choice therefore could not move while it was open. The editor sits beside that header
 * now, so it can — and a socket left on the previous machine would answer for a plugin loaded
 * somewhere else. Omitted, it falls back to the stored preference exactly as before.
 */
export function useModuleEngine(engineId?: string): ModuleEngine {
  const [phase, setPhase] = useState<EnginePhase>({ k: "looking" });
  const [paramNames, setParamNames] = useState<string[]>([]);
  const [paramMeta, setParamMeta] = useState<Record<string, ParamMeta>>({});
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const engine = useRef<EngineClient | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  // Stops the renew loop and says goodbye. Held in a ref because the lease is taken inside an
  // async body, long after the effect returned its cleanup.
  const lease = useRef<(() => void) | null>(null);
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
      // The caller's pick wins over the stored one: it is the same value, but it arrives
      // already updated when someone changes it from the header beside this editor, whereas
      // the fetch above would still be answering with what was saved a moment ago.
      const choice = chooseEngine(ranked, engineId ?? prefs.engineId);
      if (!choice.engine) return setPhase({ k: "absent" });
      const found = choice.engine;
      // The lease, exactly as pistes' EngineGate holds it. A miss is not fatal: it marks the
      // engine in use, it does not grant the connection, which the browser makes itself.
      lease.current?.(); // a previous one, if this effect re-ran on a new choice
      lease.current = holdEngine(found.engine.id, found.token!, found.tier);

      // A preview is a one-plugin throwaway project, and it used to be sent to the SAME
      // engine slot pistes had a song in — auditioning a module unloaded the song.
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
      lease.current?.();
      lease.current = null;
      engine.current?.dispose();
      engine.current = undefined;
    };
  }, [attempt, engineId]);

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

/**
 * Hold the engine ASSIGNED for as long as this tab drives it. Returns the goodbye.
 *
 * "Assigned" is a LEASE, not a flag — `assignedSeen` is a timestamp precisely because the
 * holder is a browser tab and can only say goodbye best-effort. A single `select` therefore
 * lapses after ENGINE_ASSIGN_TTL_MS: the médiathèque did exactly that, so fifteen seconds
 * into auditioning a module its engine went back to reading FREE in everyone's picker, this
 * one included. pistes' EngineGate has always renewed; this is the same loop, and the
 * constants are shared so the two cannot drift apart.
 */
function holdEngine(id: string, token: string, tier: number): () => void {
  // A miss is fine: the TTL grants grace, and a genuinely gone engine shows up on the socket.
  const renew = () => {
    engines.select(id, token, tier).catch(() => {});
  };
  renew(); // immediately — a StrictMode remount, whose cleanup released, has to re-claim
  const timer = setInterval(renew, ENGINE_ASSIGN_RENEW_MS);
  const bye = () => void engines.release(id);
  window.addEventListener("pagehide", bye);
  return () => {
    clearInterval(timer);
    window.removeEventListener("pagehide", bye);
    bye(); // unmounting without pagehide == switching away, so release now
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
