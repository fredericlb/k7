// The presenter's system: the socket, the UI snapshot React renders, the game modules and the
// websocket handlers that drive them. Built once per mount; Game2D's draw loop reads it.

import QRCode from "qrcode";
import { F } from "../canvas/drawHelpers";
import { PresenterSocket } from "../lib/ws";
import type { GamePhase } from "../types/game";
import { createCamera } from "./camera";
import { createCharacters } from "./characters";
import { createGlitch } from "./glitch";
import { GameLogic } from "./logic";
import { createParticles } from "./particles";

// UI snapshot — the only state React renders; the draw loop reads the mutable game objects.
export interface UIState {
  phase: GamePhase;
  songsLoading: boolean;
  progress: number;
  loaded: number;
  total: number;
}

export function createPresenterSystem(
  getCanvas: () => HTMLCanvasElement | null,
) {
  // ─── WebSocket ────────────────────────────────────────────────────────────
  const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new PresenterSocket(`${wsProto}//${window.location.host}/ws`);

  // ─── UI snapshot store ────────────────────────────────────────────────────
  let ui: UIState = {
    phase: "loading",
    songsLoading: false,
    progress: 0,
    loaded: 0,
    total: 0,
  };
  const uiListeners = new Set<() => void>();
  const setUI = (patch: Partial<UIState>) => {
    ui = { ...ui, ...patch };
    for (const l of uiListeners) l();
  };
  const uiStore = {
    subscribe: (cb: () => void) => {
      uiListeners.add(cb);
      return () => uiListeners.delete(cb);
    },
    get: () => ui,
  };

  // ─── Audio — monitor-web owns the AudioContext, see ../../../docs/effects.md ──
  const sendAudio = (action: string, extra: Record<string, unknown> = {}) =>
    ws.send({ type: "audio_command", payload: { action, ...extra } });

  // Bip and answer-timer tick, BASE_URL-relative so they resolve under /presenter/ in production.
  const bipAudio = new Audio(`${import.meta.env.BASE_URL}bip.wav`);
  bipAudio.volume = 0.7;
  const playBip = () => {
    bipAudio.currentTime = 0;
    bipAudio.play().catch(() => {});
  };
  const tickAudio = new Audio(`${import.meta.env.BASE_URL}timer_bip.wav`);
  tickAudio.volume = 0.2;
  const playTick = () => {
    tickAudio.currentTime = 0;
    tickAudio.play().catch(() => {});
  };

  // The canvas is the font's only user, and a web font no DOM text uses is never fetched.
  document.fonts?.load(F(16)).catch(() => {});

  // ─── Game modules ─────────────────────────────────────────────────────────
  const camera = createCamera();
  const { particles, initParticles } = createParticles();
  const { updateGlitch } = createGlitch();
  const { charStates, ensureCharState, updateCharacters } = createCharacters();

  const getW = () => getCanvas()?.width ?? 1366;

  const logic = new GameLogic({
    stop: () => sendAudio("stop"),
    pause: () => sendAudio("pause"),
    setGain: (value) => sendAudio("set_gain", { value }),
    resumeContext: () => sendAudio("resume_context"),
    // monitor-web preloads off the same `next` broadcasts, so the local preload is a no-op.
    preloadCategory: () => Promise.resolve(),
    wsSend: ws.send,
    ensureCharState,
    getCanvasWidth: getW,
    playBip,
  });
  logic.onPhaseChange((phase) => setUI({ phase }));

  // ─── QR codes — /buzzer on this origin, VITE_BUZZER_URL to name a LAN IP instead ──
  const buzzerUrl =
    (import.meta.env.VITE_BUZZER_URL as string | undefined) ||
    `${window.location.origin}/buzzer`;
  let qrImage: HTMLImageElement | null = null;
  QRCode.toDataURL(buzzerUrl, {
    width: 240,
    margin: 1,
    color: { dark: "#ffffffff", light: "#00000000" },
  })
    .then((url: string) => {
      qrImage = new Image();
      qrImage.src = url;
    })
    .catch(() => {});

  // Wi-Fi join QR in the standard `WIFI:T:…;S:…;P:…;;` payload, from .env so a venue swaps it.
  const wifiSSID = (import.meta.env.VITE_WIFI_SSID as string | undefined) || "";
  const wifiPassword =
    (import.meta.env.VITE_WIFI_PASSWORD as string | undefined) || "";
  const wifiAuth =
    (import.meta.env.VITE_WIFI_AUTH as string | undefined) || "WPA";
  const wifiQRPayload = (ssid: string, pass: string, auth: string): string => {
    const esc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
    return `WIFI:T:${esc(auth)};S:${esc(ssid)};P:${esc(pass)};;`;
  };
  let wifiQRImage: HTMLImageElement | null = null;
  if (wifiSSID) {
    QRCode.toDataURL(wifiQRPayload(wifiSSID, wifiPassword, wifiAuth), {
      width: 240,
      margin: 1,
      color: { dark: "#ffffffff", light: "#00000000" },
    })
      .then((url: string) => {
        wifiQRImage = new Image();
        wifiQRImage.src = url;
      })
      .catch(() => {});
  }

  // ─── WS handlers (registered once — the socket object survives restarts) ──
  ws.on("player_buzz", logic.handlePlayerBuzz);
  ws.on("player_added", logic.handlePlayerAdded);
  ws.on("bump", logic.handleBump);
  ws.on("score_set", logic.handleScoreSet);

  // The backend broadcasts phase_change BEFORE "next", so the next-handler's render phase wins.
  ws.on("phase_change", (payload: { phase?: string }) => {
    if (typeof payload?.phase === "string") {
      logic.setPhase(payload.phase as GamePhase);
    }
  });

  // A passive consumer of "next", so the remote can advance the game with no presenter running.
  ws.on("next", (payload: any) => {
    logic.applyNextItem(payload);
  });

  // Preload state is broadcast by monitor-web (which owns playback now).
  ws.on(
    "preload_progress",
    (payload: {
      loading: boolean;
      progress: number;
      loaded: number;
      total: number;
    }) => {
      setUI({
        songsLoading: !!payload.loading,
        progress: payload.progress ?? 0,
        loaded: payload.loaded ?? 0,
        total: payload.total ?? 0,
      });
    },
  );

  // A renderer only here: monitor-web owns the score/reveal/multi state machine.
  ws.on(
    "remote_action",
    (payload: { action: string; playerIndex?: string }) => {
      switch (payload.action) {
        case "confirm":
          logic.actionConfirm();
          break;
        case "judge":
          logic.actionJudge();
          break;
        case "select_player":
          if (payload.playerIndex) logic.setJudgingInput(payload.playerIndex);
          logic.actionJudge();
          break;
        case "skip_category":
          logic.callNextCategory();
          break;
      }
    },
  );

  // Reveal/multi state are computed by monitor-web and broadcast to renderers.
  ws.on("reveal_state", (payload: { winner: string | null }) => {
    logic.revealWinner = payload.winner;
  });
  ws.on(
    "multi_state",
    (payload: {
      removedTracks: number[];
      lastRemoved: { trackIndex: number; playerName: string | null } | null;
    }) => {
      logic.multiRemovedTracks = new Set(payload.removedTracks ?? []);
      logic.multiLastRemoved = payload.lastRemoved ?? null;
    },
  );

  return {
    ws,
    logic,
    camera,
    particles,
    initParticles,
    updateGlitch,
    charStates,
    ensureCharState,
    updateCharacters,
    uiStore,
    playTick,
    sendAudio,
    getQrImage: () => qrImage,
    getWifiQRImage: () => wifiQRImage,
    buzzerUrl,
    wifiSSID,
    wifiPassword,
  };
}

export type PresenterSystem = ReturnType<typeof createPresenterSystem>;
