// useEngineLink.ts — the shell's connection to the C++ engine, as one hook: creates the
// EngineClient, wires its callbacks into state, and exposes the stable senders the
// panes call. Extracted from App.tsx; the behaviour is unchanged.

import { EngineClient, type EngineUrl } from "@studio/engine-browser";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { EngineStore } from "@studio/engine-browser/store";
import type { ParamMeta, PresetInfo } from "@studio/engine-protocol";
import { SESSIONS, sessionFor } from "@studio/engine-protocol/sessions";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogLine } from "../components/LogsPanel";
import { beginActivity } from "../freezeWatchdog";

export interface EngineLink {
  engineRef: React.RefObject<EngineClient | undefined>;
  connected: boolean;
  engineReady: boolean;
  /** The engine is mid-apply and answering nothing (see EngineClient.onBusy). */
  engineBusy: boolean;
  /** Mirrored in a ref so `transport` can consult it without re-creating callbacks. */
  engineBusyRef: React.RefObject<boolean>;
  /** Load problems by plugin id — what the graph badges a faulty module with. */
  engineWarnings: Record<string, string>;
  /** Param ranges per plugin id — stable while the plugin is loaded (see below). */
  pluginParamMeta: Record<string, Record<string, ParamMeta>>;
  /** A module's factory presets, by MODULE name — what `list-presets` answers about. */
  presets: Record<string, PresetInfo[]>;
  listPresets: (module: string) => void;
  setPreset: (module: string, sel: { index?: number; path?: string }) => void;
  transport: (a: Parameters<EngineClient["transport"]>[0]) => void;
  seek: (seconds: number) => void;
  requestPluginParams: (id: string) => void;
  setPluginParam: (id: string, name: string, value: number) => void;
  watchPluginParams: (id: string, on: boolean) => void;
  /** Place or remove a module's waveform tap. One call, since a widget only ever toggles. */
  watchWaveform: (id: string, side: "input" | "output", on: boolean) => void;
}

export function useEngineLink(
  engineUrl: EngineUrl,
  /** Who is logged in — the session id's other half. See @studio/engine-protocol/sessions. */
  userEmail: string,
  store: EngineStore,
  pluginParamsStore: PluginParamsStore,
  onStatus: (s: string) => void,
  pushLog: (kind: LogLine["kind"], text: string) => void,
): EngineLink {
  const engineRef = useRef<EngineClient | undefined>(undefined);
  const engineBusyRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [engineBusy, setEngineBusy] = useState(false);
  // Load problems the engine reported, by SUBJECT — a PluginDoc id, which is what a node carries as `pluginId`; latest per subject wins.
  const [engineWarnings, setEngineWarnings] = useState<Record<string, string>>(
    {},
  );
  const [pluginParamMeta, setPluginParamMeta] = useState<
    Record<string, Record<string, ParamMeta>>
  >({});
  // A module's factory presets, by module name. See listPresets below for why the key is a name.
  const [presets, setPresets] = useState<Record<string, PresetInfo[]>>({});

  useEffect(() => {
    // The session id is per SERVICE and per PERSON, spelled through `sessionFor` so the file service cannot derive a different one.
    const engine = new EngineClient(
      engineUrl,
      beginActivity,
      sessionFor(SESSIONS.st0, userEmail),
    );
    engineRef.current = engine;
    // 'Ready' is a one-way latch, so it is set ONCE: React bails out on the identical value, but it still entered the scheduler 20 times a second.
    let ready = false;
    const offState = engine.onState((s) => {
      store.set(s); // external store — subscribers re-render on the slice they read
      if (ready) return;
      ready = true;
      setEngineReady(true);
    });
    const offParams = engine.onPluginParams(({ id, params, meta }) => {
      pluginParamsStore.set(id, params);
      // Ranges are stable while a plugin is loaded, so they live in ordinary state — the 20 Hz store carries no meta and would drop them.
      if (meta) setPluginParamMeta((m) => ({ ...m, [id]: meta }));
    });
    const offLiveParams = engine.onPluginParamsLive(({ id, params }) =>
      pluginParamsStore.set(id, params),
    );
    // Kept by MODULE and REPLACED rather than merged: this answers one question about one module.
    const offPresets = engine.onPresets((module, list) =>
      setPresets((p) => ({ ...p, [module]: list })),
    );
    const offBusy = engine.onBusy((b) => {
      // A new apply rebuilds every plugin, so the previous load's complaints are stale — a model you just fixed must lose its badge.
      if (b) setEngineWarnings({});
      engineBusyRef.current = b;
      setEngineBusy(b);
    });
    // Engine trouble goes to the log panel AND the status bar: it is usually the only explanation for something that looks like it worked.
    const offWarning = engine.onWarning(({ subject, message }) => {
      if (subject) setEngineWarnings((w) => ({ ...w, [subject]: message }));
      const text = subject ? `${subject}: ${message}` : message;
      pushLog("error", `engine: ${text}`);
      onStatus(`engine: ${text}`);
    });
    const offConn = engine.onConnected((c) => {
      setConnected(c);
      // …and re-open the latch above, or a reconnected engine would never read ready again.
      if (!c) {
        ready = false;
        setEngineReady(false);
      }
      // A socket that drops mid-apply never delivers busy:false, so the flag belongs to the connection, not a message.
      if (!c) {
        engineBusyRef.current = false;
        setEngineBusy(false);
      }
      onStatus(c ? "connected to engine" : "engine offline — retrying…");
      pushLog(
        "engine",
        c ? "connected to engine" : "engine offline — retrying…",
      );
    });
    engine.connect();
    return () => {
      offState();
      offConn();
      offParams();
      offLiveParams();
      offPresets();
      offWarning();
      offBusy();
      engine.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const transport = useCallback(
    (a: Parameters<EngineClient["transport"]>[0]) => {
      // Dropped, not queued: a Play sent while the engine is applying fires seconds later with every other click made meanwhile.
      if (engineBusyRef.current) return;
      engineRef.current?.transport(a);
    },
    [],
  );
  const seek = useCallback(
    (seconds: number) => engineRef.current?.seek(seconds),
    [],
  );
  const requestPluginParams = useCallback(
    (id: string) => engineRef.current?.getPluginParams(id),
    [],
  );
  /** A module's FACTORY presets, keyed by module NAME because that is what `list-presets` takes: it resolves the name to a live instance. */
  const listPresets = useCallback((module: string) => {
    engineRef.current?.listPresets(module);
  }, []);
  const setPreset = useCallback(
    (module: string, sel: { index?: number; path?: string }) =>
      engineRef.current?.setPreset(module, sel),
    [],
  );
  const setPluginParam = useCallback(
    (id: string, name: string, value: number) =>
      engineRef.current?.setPluginParam(id, name, value),
    [],
  );
  const watchPluginParams = useCallback(
    (id: string, on: boolean) => engineRef.current?.watchPluginParams(id, on),
    [],
  );

  const watchWaveform = useCallback(
    (id: string, side: "input" | "output", on: boolean) => {
      if (on) engineRef.current?.subscribeWaveform(id, side);
      else engineRef.current?.unsubscribeWaveform(id, side);
    },
    [],
  );

  return {
    engineWarnings,
    watchWaveform,
    engineRef,
    connected,
    engineReady,
    engineBusy,
    engineBusyRef,
    pluginParamMeta,
    presets,
    listPresets,
    setPreset,
    transport,
    seek,
    requestPluginParams,
    setPluginParam,
    watchPluginParams,
  };
}
