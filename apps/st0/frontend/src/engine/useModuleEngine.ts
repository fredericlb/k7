// useModuleEngine.ts — the engine as the module editor needs it: connect to the one this
// ACCOUNT chose, load one module, and report what its plugin's parameters are called and
// what they span. Nothing else — no transport, no meters. See docs/engine.md.

import { EngineClient } from "@studio/engine-browser";
import type { ParamMeta, PresetInfo } from "@studio/engine-protocol";
import type { ProjectDoc } from "@studio/engine-protocol/project";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { useCallback, useEffect, useRef, useState } from "react";
import { currentUser, engines } from "../api";
import { modulePreviewDoc, previewPluginId } from "./preview";

export type EnginePhase =
  | { k: "looking" }
  | { k: "absent" }
  | { k: "ready"; id: string };

export interface ModuleEngine {
  phase: EnginePhase;
  /** The chosen machine's file service, as its own probe reported it — null when none answered.
   *  The médiathèque is hosted and the moteur opens PATHS, so anything that plays audio has to
   *  find it on that machine's disk. See m9's docs/plumbing.md, which walks the same route. */
  fileBase: string | null;
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
  /**
   * Send a document and start the transport — what a chain preview needs and a module preview
   * does not. It REPLACES whatever this session held, the one-module doc included: the session
   * is per service and per person (see below), and auditioning two things at once on one engine
   * is not a thing to arrange, it is a thing to forbid.
   */
  play: (doc: ProjectDoc) => void;
  stop: () => void;
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
  const [fileBase, setFileBase] = useState<string | null>(null);
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
      // The caller's pick wins over the stored one: it is the same value, but it arrives
      // already updated when someone changes it from the header beside this editor, whereas
      // the fetch inside would still be answering with what was saved a moment ago.
      const { chosen } = await engines.find(engineId);
      if (cancelled) return;
      if (!chosen) return setPhase({ k: "absent" });
      const found = chosen;
      setFileBase(found.fileBase ?? null);
      // The lease, exactly as l8' EngineGate holds it. A miss is not fatal: it marks the
      // engine in use, it does not grant the connection, which the browser makes itself.
      lease.current?.(); // a previous one, if this effect re-ran on a new choice
      lease.current = engines.hold(found);

      // A preview is a one-plugin throwaway project, and it used to be sent to the SAME
      // engine slot l8 had a song in — auditioning a module unloaded the song.
      // Per SERVICE and per PERSON: the médiathèque is hosted, so two people can choose the
      // same machine, and on a bare "st0" one of them auditioning a module would tear
      // down the other's preview mid-listen.
      const client = new EngineClient(
        found.wsUrl!,
        undefined,
        sessionFor(SESSIONS.st0, currentUser()),
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

  // The document first, THEN the verb. A transport verb sent first plays whatever the engine
  // still had loaded — here, the last module preview — which is a second of the wrong sound
  // before the right one. m9's loadAndPlay orders it the same way, for the same reason.
  const play = useCallback<ModuleEngine["play"]>((doc) => {
    const client = engine.current;
    if (!client) return;
    client.sendProject(doc);
    client.transport("play");
  }, []);

  const stop = useCallback(() => engine.current?.transport("stop"), []);

  return {
    phase,
    fileBase,
    paramNames,
    paramMeta,
    presets,
    preview,
    listPresets,
    setPreset,
    play,
    stop,
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
