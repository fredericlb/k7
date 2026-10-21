// useEngineLink.ts — the shell's connection to the C++ engine, as one hook: creates the
// EngineClient, wires its callbacks into state, and exposes the stable senders the
// panes call, so App.tsx holds no engine wiring of its own.

import { EngineClient, type EngineUrl } from "@studio/engine-browser";
import { playEngineOutput } from "@studio/engine-browser/engine-output";
import type { PluginParamsStore } from "@studio/engine-browser/params";
import type { EngineStore } from "@studio/engine-browser/store";
import type { ParamMeta, PresetInfo } from "@studio/engine-protocol";
import { showToast } from "@studio/project-shell/toast";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LogLine } from "../components/LogsPanel";
import { engineSession } from "../engineSession";
import { beginActivity, tally } from "../freezeWatchdog";
import { m } from "../paraglide/messages.js";
import { throughPanicRule } from "../transportPanic";
import { useLatest } from "./useLatest";

export interface EngineLink {
  engineRef: React.RefObject<EngineClient | undefined>;
  connected: boolean;
  engineReady: boolean;
  /** The engine is mid-apply and answering nothing (see EngineClient.onBusy). */
  engineBusy: boolean;
  /** Mirrored in a ref so `transport` can consult it without re-creating callbacks. */
  engineBusyRef: React.RefObject<boolean>;
  /** The engine's sound is played by this page (the server's engine), not by its own machine. */
  audioToBrowser: boolean;
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
  // The link's state and the status sink as refs, so `transport` can refuse aloud without being re-created.
  const connectedRef = useRef(false);
  const onStatusRef = useLatest(onStatus);
  const [connected, setConnected] = useState(false);
  const [engineReady, setEngineReady] = useState(false);
  const [engineBusy, setEngineBusy] = useState(false);
  // Whether the engine's sound is played by THIS page (the server's engine) rather than by its own machine's speakers.
  const [audioToBrowser, setAudioToBrowser] = useState(false);
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
    // Per SERVICE and per PERSON, the bench a service of its own — the file service derives the same name from the workspace.
    const engine = new EngineClient(
      engineUrl,
      beginActivity,
      engineSession(
        userEmail,
        window.location.pathname,
        import.meta.env.BASE_URL,
      ),
      tally,
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
    const offWarning = engine.onWarning(({ subject, message, code }) => {
      // The pairing prompt asks every engine for its requests; a LAN one saying "not from here" is an answer, not trouble.
      if (code === "local-only") return;
      if (subject) setEngineWarnings((w) => ({ ...w, [subject]: message }));
      const text = subject ? `${subject}: ${message}` : message;
      pushLog("error", `engine: ${text}`);
      onStatus(`engine: ${text}`);
    });
    // What the project was BUILT with, after every apply: a no-op apply's busy cleared the badges a build made before this page connected.
    const offStanding = engine.onStandingWarnings((list) =>
      setEngineWarnings(
        Object.fromEntries(
          list.filter((w) => w.subject).map((w) => [w.subject, w.message]),
        ),
      ),
    );
    // A crash is not a blip: the engine lost the project, and that is said where it cannot be missed.
    const offRestart = engine.onEngineRestart(() => {
      pushLog("error", "engine: it crashed and was restarted");
      showToast({
        message: m["engine.crashed"](),
        variant: "error",
        placement: "top-right",
      });
    });
    // Safe mode is said once on entering, naming the plugin it suspects: the project plays, but without its external plugins.
    const offSafeMode = engine.onSafeMode((safe) => {
      if (!safe) return;
      const suspect = safe.diedLoading
        ? m["engine.safeModeDiedLoading"]({ plugin: safe.diedLoading })
        : safe.lastPlugin
          ? m["engine.safeModeLastPlugin"]({ plugin: safe.lastPlugin })
          : "";
      const text = `${m["engine.safeMode"]({ crashes: safe.crashes })}${suspect ? ` ${suspect}` : ""}`;
      pushLog("error", `engine: ${text}`);
      showToast({ message: text, variant: "error", placement: "top-right" });
    });
    const offConn = engine.onConnected((c) => {
      connectedRef.current = c;
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
        // A dead engine plays nothing: without this the last frame's `playing: true` keeps the transport and playhead running.
        store.offline();
      }
      onStatus(c ? "connected to engine" : "engine offline — retrying…");
      pushLog(
        "engine",
        c ? "connected to engine" : "engine offline — retrying…",
      );
    });
    engine.connect();
    // An engine nobody hears — the server's own — is heard here, through its broadcast.
    const offOutput = playEngineOutput(engine);
    // …and that is said in the header, since where the sound comes out is not otherwise visible.
    const offToBrowser = engine.onAudioToBrowser(setAudioToBrowser);
    return () => {
      offToBrowser();
      offOutput();
      offState();
      offConn();
      offParams();
      offLiveParams();
      offPresets();
      offWarning();
      offStanding();
      offRestart();
      offSafeMode();
      offBusy();
      engine.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the last stop was sent, so a second one can read as "that did not work" — transportPanic.ts.
  const lastStopAt = useRef<number | null>(null);
  const transport = useCallback(
    (a: Parameters<EngineClient["transport"]>[0]) => {
      // Dropped, not queued: a Play sent while the engine is applying fires seconds later with every other click made meanwhile.
      if (engineBusyRef.current) return;
      // …and so is one sent down a dead link, said aloud: the outbox would otherwise play it up to 30 s late.
      if (!connectedRef.current) {
        onStatusRef.current(m["engine.notPlayed"]());
        return;
      }
      const step = throughPanicRule(a, Date.now(), lastStopAt.current);
      lastStopAt.current = step.lastStopAt;
      engineRef.current?.transport(step.send);
      // The drawn playhead stops on the press, not when the engine's stopped frame lands 50–100 ms later (docs/playhead.md).
      const stops =
        step.send === "stop" ||
        step.send === "panic" ||
        (step.send === "toggle" && store.getSnapshot().playing);
      if (stops) store.pressed("stop");
      else if (step.send === "play" || step.send === "toggle")
        store.pressed("play");
    },
    [store],
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
    audioToBrowser,
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
