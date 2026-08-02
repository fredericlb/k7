// useEngineLink.ts — the shell's connection to the C++ engine, as one hook: creates the
// EngineClient, wires its callbacks into state, and exposes the stable senders the
// panes call. Extracted from App.tsx; the behaviour is unchanged.

import type { ParamMeta } from "@studio/engine-protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogLine } from "../components/LogsPanel";
import { EngineClient } from "../engine";
import type { EngineStore } from "../engineStore";
import type { PluginParamsStore } from "../pluginParamsStore";
import type { PresetInfo } from "../types";

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
  modulePresets: PresetInfo[];
  setModulePresets: (p: PresetInfo[]) => void;
  transport: (a: Parameters<EngineClient["transport"]>[0]) => void;
  seek: (seconds: number) => void;
  requestPluginParams: (id: string) => void;
  setPluginParam: (id: string, name: string, value: number) => void;
  watchPluginParams: (id: string, on: boolean) => void;
  /** Place or remove a module's waveform tap. One call, since a widget only ever toggles. */
  watchWaveform: (id: string, side: "input" | "output", on: boolean) => void;
}

export function useEngineLink(
  engineUrl: string,
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
  // Load problems the engine reported, by SUBJECT — a PluginDoc id ("chain:module"), which
  // is what a graph node carries as `pluginId`. Latest message per subject wins.
  const [engineWarnings, setEngineWarnings] = useState<Record<string, string>>(
    {},
  );
  const [modulePresets, setModulePresets] = useState<PresetInfo[]>([]);
  const [pluginParamMeta, setPluginParamMeta] = useState<
    Record<string, Record<string, ParamMeta>>
  >({});

  useEffect(() => {
    const engine = new EngineClient(engineUrl);
    engineRef.current = engine;
    const offState = engine.onState((s) => {
      store.set(s); // external store — subscribers re-render on the slice they read
      setEngineReady(true);
    });
    const offParams = engine.onPluginParams(({ id, params, meta }) => {
      pluginParamsStore.set(id, params);
      // Ranges are stable while a plugin is loaded, so they live in ordinary state — pluginParamsStore is rewritten
      // wholesale by the 20 Hz feed, which carries no meta and would drop them on the next frame.
      if (meta) setPluginParamMeta((m) => ({ ...m, [id]: meta }));
    });
    const offLiveParams = engine.onPluginParamsLive(({ id, params }) =>
      pluginParamsStore.set(id, params),
    );
    const offPresets = engine.onPresets((_module, presets) =>
      setModulePresets(presets),
    );
    const offBusy = engine.onBusy((b) => {
      // A new apply rebuilds every plugin, so the previous load's complaints are stale —
      // a model you just fixed must not keep its badge until the page reloads.
      if (b) setEngineWarnings({});
      engineBusyRef.current = b;
      setEngineBusy(b);
    });
    // Engine trouble goes to the log panel AND the status bar: it is usually the only
    // explanation for something that looks like it worked (a plugin in the chain doing
    // nothing to the sound), so it must not be somewhere you have to think to open.
    const offWarning = engine.onWarning(({ subject, message }) => {
      if (subject) setEngineWarnings((w) => ({ ...w, [subject]: message }));
      const text = subject ? `${subject}: ${message}` : message;
      pushLog("error", `engine: ${text}`);
      onStatus(`engine: ${text}`);
    });
    const offConn = engine.onConnected((c) => {
      setConnected(c);
      if (!c) setEngineReady(false);
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
      // Dropped, not queued: a Play sent while the engine is applying fires seconds later, together with every other
      // click made meanwhile — which is how one press became three plays, a stop and a rewind. The status bar says why.
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
    modulePresets,
    setModulePresets,
    transport,
    seek,
    requestPluginParams,
    setPluginParam,
    watchPluginParams,
  };
}
