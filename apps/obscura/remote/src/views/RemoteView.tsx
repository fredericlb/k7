import { Button } from "@frediverse/ui/button";
import { Input } from "@frediverse/ui/input";
import { SessionPicker } from "obscura-shared/session-picker";
import type { LoadProgress, SessionRow } from "obscura-shared/types";
import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { AuthBadge } from "../components/AuthBadge";
import { LoginGate } from "../components/LoginGate";
import { f } from "../lib/api";
import { useAuth } from "../lib/auth";
import { BuzzerSocket } from "../lib/ws";
import { m } from "../paraglide/messages.js";

// The server names the phase at runtime, so the lookup can't be a computed
// message key — Paraglide only compiles calls it can see. Unknown phases fall
// back to the raw name, uppercased, as tOr() used to do.
const PHASE_LABELS: Partial<Record<string, () => string>> = {
  unknown: m["remote.phases.unknown"],
  loading: m["remote.phases.loading"],
  title: m["remote.phases.title"],
  registration: m["remote.phases.registration"],
  scoreboard: m["remote.phases.scoreboard"],
  category: m["remote.phases.category"],
  "mystery-question": m["remote.phases.mystery-question"],
  song: m["remote.phases.song"],
  answering: m["remote.phases.answering"],
  judging: m["remote.phases.judging"],
  reveal: m["remote.phases.reveal"],
  end: m["remote.phases.end"],
  pause: m["remote.phases.pause"],
};

// The host's remote control (port of RemoteView.vue). WS-driven state lives
// on a mutable ref (`g`) + force-render, exactly like the buzzer port. The
// remote owns session selection, judging, scoring, registration toggles, and
// simulated buzzer players; phase transitions themselves are server-driven.

interface Player {
  name: string;
  deviceId: string;
  score: number;
}
interface MultiTrack {
  title: string;
  artist?: string;
  removed: boolean;
}
interface PeekInfo {
  type: string;
  categoryName?: string;
  songArtist?: string;
  songTitle?: string;
  mode?: string;
  finished?: boolean;
}

const ANSWER_DURATION = 12;
const PUNISH_AMOUNT = 2000;
const POLITENESS_KEY = "remote_politeness_enabled";

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

export function RemoteView() {
  const { status: authStatus, error: authError, user: authUser } = useAuth();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const render = force as () => void;

  const socketRef = useRef<BuzzerSocket | null>(null);
  if (!socketRef.current) {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    socketRef.current = new BuzzerSocket(
      `${wsProto}//${window.location.host}/ws?role=remote`,
    );
  }
  const socket = socketRef.current;
  const isConnected = useSyncExternalStore(
    socket.subscribe,
    socket.isConnected,
  );

  const g = useRef({
    needsUnlock: true,
    activeTab: "controls" as "controls" | "manual" | "players" | "buzzers",
    // session picker
    sessions: [] as SessionRow[],
    activeSessionId: 0,
    sessionsLoading: false,
    sessionsError: "",
    sessionSelecting: 0,
    sessionProgress: null as LoadProgress | null,
    sessionPickerOpen: false,
    // game state
    gamePhase: "unknown",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    currentItem: null as any,
    players: [] as Player[],
    connectedDevices: new Set<string>(),
    buzzingPlayers: new Set<string>(),
    latestBuzzer: null as string | null,
    categoryName: "",
    peekInfo: null as PeekInfo | null,
    answerRemaining: 0,
    // audio
    gainLevel: 80,
    isMuted: false,
    micEnabled: false,
    micGainPct: 100,
    audioPlaying: false,
    audioPaused: false,
    // multi
    currentMode: "",
    multiTracks: [] as MultiTrack[],
    pendingScorePlayer: null as string | null,
    showTrackPicker: false,
    // holds
    skipHolding: false,
    skipProgress: 0,
    nextHolding: false,
    nextProgress: 0,
    // preload mirror
    preloading: false,
    preloadProgress: 0,
    preloadLoaded: 0,
    preloadTotal: 0,
    preloadFailedPaths: [] as string[],
    // setup tab
    newPlayerName: "",
    createPlayerError: "",
    politenessEnabled: localStorage.getItem(POLITENESS_KEY) !== "0",
    registrationLocked: false,
    // modals
    scoreEditorOpen: false,
    scoreEditorPlayer: null as string | null,
    scoreEditorValue: 0,
    punishConfirmOpen: false,
    punishTarget: null as string | null,
  }).current;

  const nr = useRef({
    songStartTime: 0,
    buzzElapsed: 0,
    answerStartMs: 0,
    answerAnimFrame: 0,
    skipStartTime: 0,
    skipAnimFrame: 0,
    nextStartTime: 0,
    nextAnimFrame: 0,
    buzzerSockets: new Map<string, WebSocket>(),
    wakeLockAcquired: false,
    noSleepVideo: null as HTMLVideoElement | null,
    noSleepAudioCtx: null as AudioContext | null,
  }).current;

  // ── wake lock (same three-tier strategy as the buzzer) ─────────────────

  async function acquireWakeLock() {
    if (nr.wakeLockAcquired) return;
    if ("wakeLock" in navigator) {
      try {
        await (
          navigator as Navigator & {
            wakeLock: { request(t: string): Promise<unknown> };
          }
        ).wakeLock.request("screen");
        nr.wakeLockAcquired = true;
        return;
      } catch {
        /* HTTP — fall through */
      }
    }
    if (!nr.noSleepVideo) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const stream = canvas.captureStream(1);
        const video = document.createElement("video");
        video.setAttribute("playsinline", "");
        video.muted = true;
        video.style.cssText =
          "position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0.01";
        video.srcObject = stream;
        document.body.appendChild(video);
        nr.noSleepVideo = video;
      } catch {
        /* unsupported */
      }
    }
    if (nr.noSleepVideo) {
      try {
        await nr.noSleepVideo.play();
        nr.wakeLockAcquired = true;
        return;
      } catch {
        /* blocked */
      }
    }
    if (!nr.noSleepAudioCtx) {
      try {
        nr.noSleepAudioCtx = new AudioContext();
        const osc = nr.noSleepAudioCtx.createOscillator();
        const gain = nr.noSleepAudioCtx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(nr.noSleepAudioCtx.destination);
        osc.start();
        nr.wakeLockAcquired = true;
      } catch {
        /* unsupported */
      }
    }
  }

  const ensureWakeLock = () => {
    if (!nr.wakeLockAcquired) void acquireWakeLock();
  };

  // ── answer timer ────────────────────────────────────────────────────────

  function stopAnswerTimer() {
    if (nr.answerAnimFrame) cancelAnimationFrame(nr.answerAnimFrame);
    nr.answerAnimFrame = 0;
    g.answerRemaining = 0;
    render();
  }

  function startAnswerTimer() {
    stopAnswerTimer();
    nr.answerStartMs = performance.now();
    g.answerRemaining = ANSWER_DURATION;
    const tick = () => {
      const elapsed = (performance.now() - nr.answerStartMs) / 1000;
      g.answerRemaining = Math.max(0, ANSWER_DURATION - elapsed);
      render();
      if (g.answerRemaining > 0 && g.gamePhase === "answering") {
        nr.answerAnimFrame = requestAnimationFrame(tick);
      }
    };
    nr.answerAnimFrame = requestAnimationFrame(tick);
  }

  function setPhase(phase: string) {
    const prev = g.gamePhase;
    if (prev === phase) return;
    g.gamePhase = phase;
    if (phase === "answering" && prev !== "answering") startAnswerTimer();
    else if (phase !== "answering" && prev === "answering") stopAnswerTimer();
    render();
  }

  // ── session picker ──────────────────────────────────────────────────────

  async function refreshSessions() {
    g.sessionsLoading = true;
    g.sessionsError = "";
    render();
    try {
      const r = await f("/api/sessions", { cache: "no-store" });
      if (!r.ok) {
        g.sessionsError = `${r.status} ${r.statusText}`;
        return;
      }
      const data = (await r.json()) as {
        sessions?: SessionRow[];
        activeId?: number;
      };
      g.sessions = Array.isArray(data.sessions) ? data.sessions : [];
      g.activeSessionId = data.activeId ?? 0;
    } catch (e) {
      g.sessionsError = (e as Error).message;
    } finally {
      g.sessionsLoading = false;
      render();
    }
  }

  async function selectSession(id: number) {
    if (g.sessionSelecting || g.activeSessionId === id) return;
    g.sessionSelecting = id;
    g.sessionsError = "";
    render();
    try {
      const r = await f("/api/sessions/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!r.ok) {
        const body = await r.text();
        g.sessionsError = `select failed: ${body || r.statusText}`;
        return;
      }
      g.activeSessionId = id;
    } catch (e) {
      g.sessionsError = (e as Error).message;
    } finally {
      g.sessionSelecting = 0;
      render();
    }
  }

  // ── actions ─────────────────────────────────────────────────────────────

  const sendAction = (action: string, extra: Record<string, string> = {}) =>
    socket.send({ type: "remote_action", payload: { action, ...extra } });
  const sendAudioCommand = (
    action: string,
    extra: Record<string, unknown> = {},
  ) => socket.send({ type: "audio_command", payload: { action, ...extra } });

  const sendPolitenessState = () =>
    sendAction("set_politeness", { enabled: g.politenessEnabled ? "1" : "0" });

  const doNext = () =>
    f("/api/next", { method: "POST" }).catch((e) =>
      console.error("Failed /api/next:", e),
    );

  async function setPlayerScore(playerName: string, score: number) {
    try {
      await f("/api/score/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName, score }),
      });
      const p = g.players.find((pl) => pl.name === playerName);
      if (p) p.score = score;
      render();
    } catch (e) {
      console.error("Failed to set score:", e);
    }
  }

  async function scorePlayer(playerName: string) {
    if (g.currentMode === "multi") {
      g.pendingScorePlayer = playerName;
      g.showTrackPicker = true;
      render();
      return;
    }
    try {
      const res = await f("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName }),
      });
      if (res.ok) {
        const data = await res.json();
        const p = g.players.find((pl) => pl.name === playerName);
        if (p) p.score = data.score;
        render();
      }
    } catch (e) {
      console.error("Score failed:", e);
    }
    sendAction("score_and_reveal", { playerName });
  }

  function noWinner() {
    if (g.currentMode === "multi") {
      g.pendingScorePlayer = null;
      g.showTrackPicker = true;
      render();
      return;
    }
    sendAction("no_winner");
  }

  async function goodResponse() {
    if (!g.latestBuzzer) return;
    const name = g.latestBuzzer;
    const p = g.players.find((pl) => pl.name === name);
    if (p) {
      const speedBonus = Math.max(
        0,
        Math.round(100 * (1 - nr.buzzElapsed / 20)),
      );
      await setPlayerScore(name, p.score + 1000 + speedBonus);
    }
    g.latestBuzzer = null;
    render();
    sendAction("score_and_reveal", { playerName: name });
  }

  async function badResponseAction() {
    if (!g.latestBuzzer) return;
    const name = g.latestBuzzer;
    const p = g.players.find((pl) => pl.name === name);
    if (p) await setPlayerScore(name, p.score - 100);
    sendAction("bad_response");
    g.latestBuzzer = null;
    render();
  }

  async function pickMultiTrack(trackIndex: number) {
    const playerName = g.pendingScorePlayer;
    if (playerName) {
      try {
        const res = await f("/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName }),
        });
        if (res.ok) {
          const data = await res.json();
          const p = g.players.find((pl) => pl.name === playerName);
          if (p) p.score = data.score;
        }
      } catch (e) {
        console.error("Score failed:", e);
      }
      sendAction("multi_score", { playerName, trackIndex: String(trackIndex) });
    } else {
      sendAction("multi_no_winner", { trackIndex: String(trackIndex) });
    }
    if (g.multiTracks[trackIndex]) g.multiTracks[trackIndex].removed = true;
    g.showTrackPicker = false;
    g.pendingScorePlayer = null;
    render();
  }

  async function fetchPeek() {
    try {
      const res = await f("/api/peek");
      if (res.ok) {
        g.peekInfo = await res.json();
        render();
      }
    } catch {
      /* ignore */
    }
  }

  async function finishRegistrationAndStart() {
    try {
      await f("/api/players/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      /* ignore */
    }
    await doNext();
  }

  // Simulated players: real buzzer WS connections, so buzzing from the BUZZ
  // tab goes through the genuine pipeline.
  async function addPlayer() {
    const name = g.newPlayerName.trim();
    if (!name) return;
    g.createPlayerError = "";
    render();
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = crypto.randomUUID();
    const ws = new WebSocket(
      `${wsProto}//${window.location.host}/ws/buzzer?token=${token}`,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ws.close();
          reject(new Error("Timeout"));
        }, 5000);
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data as string);
            if (msg.type === "welcome")
              ws.send(JSON.stringify({ type: "buzz", payload: {} }));
            if (msg.type === "name_required")
              ws.send(JSON.stringify({ type: "register", payload: { name } }));
            if (msg.type === "registered") {
              clearTimeout(timeout);
              nr.buzzerSockets.set(name, ws);
              resolve();
            }
            if (msg.type === "register_error") {
              clearTimeout(timeout);
              ws.close();
              reject(new Error(msg.payload?.error ?? "Registration failed"));
            }
          } catch {
            /* ignore parse errors */
          }
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Connection failed"));
        };
      });
      g.newPlayerName = "";
    } catch (e) {
      g.createPlayerError = (e as Error).message ?? "Failed";
    }
    render();
  }

  function buzzPlayer(playerName: string) {
    const ws = nr.buzzerSockets.get(playerName);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "buzz", payload: {} }));
      return;
    }
    // Fallback for players registered from real phones.
    const p = g.players.find((pl) => pl.name === playerName);
    if (p)
      socket.send({ type: "debug_buzz", payload: { deviceId: p.deviceId } });
  }

  async function setRegistrationLocked(locked: boolean) {
    try {
      const res = await f("/api/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked }),
      });
      if (res.ok) {
        g.registrationLocked = locked;
        render();
      }
    } catch {
      /* ignore */
    }
  }

  async function unlockPlayerDevice(playerName: string) {
    try {
      const res = await f("/api/players/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName }),
      });
      if (res.ok) {
        const p = g.players.find((pl) => pl.name === playerName);
        if (p) p.deviceId = "";
        render();
      }
    } catch (e) {
      console.error("Failed to unlock device:", e);
    }
  }

  // ── hold buttons ────────────────────────────────────────────────────────

  function skipTouchStart() {
    g.skipHolding = true;
    g.skipProgress = 0;
    nr.skipStartTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - nr.skipStartTime) / 1000;
      g.skipProgress = Math.min(elapsed / 5, 1);
      render();
      if (g.skipProgress >= 1) {
        g.skipHolding = false;
        g.skipProgress = 0;
        render();
        void f("/api/next", { method: "POST" }).catch((e) =>
          console.error("Failed /api/next (skip):", e),
        );
        return;
      }
      if (g.skipHolding) nr.skipAnimFrame = requestAnimationFrame(animate);
    };
    nr.skipAnimFrame = requestAnimationFrame(animate);
  }

  function skipTouchEnd() {
    g.skipHolding = false;
    g.skipProgress = 0;
    cancelAnimationFrame(nr.skipAnimFrame);
    render();
  }

  const nextDisabled = () => {
    if (g.gamePhase === "registration" && g.players.length === 0) return true;
    if (["song", "answering", "judging"].includes(g.gamePhase)) return true;
    return false;
  };

  function nextTouchStart() {
    if (nextDisabled()) return;
    g.nextHolding = true;
    g.nextProgress = 0;
    nr.nextStartTime = performance.now();
    const animate = () => {
      const elapsed = (performance.now() - nr.nextStartTime) / 1000;
      g.nextProgress = Math.min(elapsed / 1, 1);
      render();
      if (g.nextProgress >= 1) {
        g.nextHolding = false;
        g.nextProgress = 0;
        render();
        if (g.gamePhase === "registration") void finishRegistrationAndStart();
        else void doNext();
        return;
      }
      if (g.nextHolding) nr.nextAnimFrame = requestAnimationFrame(animate);
    };
    nr.nextAnimFrame = requestAnimationFrame(animate);
  }

  function nextTouchEnd() {
    g.nextHolding = false;
    g.nextProgress = 0;
    cancelAnimationFrame(nr.nextAnimFrame);
    render();
  }

  // ── hydrate + socket wiring (once) ──────────────────────────────────────

  async function hydrate() {
    try {
      const res = await f("/api/game");
      const info = await res.json();
      g.registrationLocked = Boolean(info.registrationComplete);
      if (info.players?.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        g.players = info.players.map((p: any) => ({
          name: p.name,
          deviceId: p.deviceId,
          score: p.score ?? 0,
        }));
      }
      if (Array.isArray(info.connectedDevices))
        g.connectedDevices = new Set(info.connectedDevices);
      if (info.currentItem) {
        g.currentItem = info.currentItem;
        g.currentMode = info.currentItem.mode ?? "";
        if (info.currentItem.category?.name)
          g.categoryName = info.currentItem.category.name;
        if (info.currentItem.finished) setPhase("end");
        else if (info.currentItem.type === "category") setPhase("category");
        else if (info.currentItem.type === "song") {
          // Prefer the authoritative phase mid-song so a refresh during
          // reveal doesn't collapse back to "song".
          if (
            info.phase &&
            ["answering", "judging", "reveal"].includes(info.phase)
          )
            setPhase(info.phase);
          else setPhase("song");
        }
      } else if (info.phase) {
        setPhase(info.phase);
      } else {
        setPhase("registration");
      }
      render();
    } catch {
      /* ignore */
    }
    await fetchPeek();
  }

  useEffect(() => {
    socket.connect();
    void hydrate();
    void refreshSessions();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        nr.wakeLockAcquired = false;
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    socket.on("connected", () => sendPolitenessState());

    socket.on(
      "session_loading",
      (p: { id?: number; done?: number; total?: number; name?: string }) => {
        if (
          typeof p.id === "number" &&
          typeof p.done === "number" &&
          typeof p.total === "number"
        ) {
          g.sessionProgress = {
            id: p.id,
            done: p.done,
            total: p.total,
            name: typeof p.name === "string" ? p.name : "",
          };
          render();
        }
      },
    );
    socket.on("session_selected", (p: { id?: number }) => {
      if (typeof p.id === "number") {
        g.activeSessionId = p.id;
        if (g.sessionProgress?.id === p.id) g.sessionProgress = null;
        g.sessionPickerOpen = false;
        render();
        void refreshSessions();
      }
    });

    socket.on("registration_state", (p: { locked: boolean }) => {
      g.registrationLocked = Boolean(p.locked);
      render();
    });

    socket.on("phase_change", (p: { phase?: string }) => {
      if (p.phase) setPhase(p.phase);
    });

    socket.on(
      "preload_progress",
      (p: {
        loading: boolean;
        progress: number;
        loaded: number;
        total: number;
      }) => {
        g.preloading = p.loading;
        g.preloadProgress = p.progress;
        g.preloadLoaded = p.loaded;
        g.preloadTotal = p.total;
        render();
      },
    );

    socket.on("preload_failed", (p: { paths: string[] }) => {
      g.preloadFailedPaths = p.paths ?? [];
      render();
    });

    socket.on("playback_state", (p: { playing: boolean; paused: boolean }) => {
      g.audioPlaying = Boolean(p.playing);
      g.audioPaused = Boolean(p.paused);
      render();
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket.on("next", (payload: any) => {
      g.currentItem = payload;
      g.currentMode = payload.mode ?? "";
      if (payload.finished) {
        setPhase("end");
      } else if (payload.type === "category") {
        g.categoryName = payload.category?.name ?? "";
        setPhase("category");
      } else if (payload.type === "song") {
        setPhase("song");
        g.latestBuzzer = null;
        nr.songStartTime = performance.now();
        g.showTrackPicker = false;
        if (payload.mode === "multi" && payload.song?.tracks) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          g.multiTracks = payload.song.tracks.map((tr: any) => ({
            title: tr.title ?? tr.artist ?? "Track",
            artist: tr.artist,
            removed: false,
          }));
        } else {
          g.multiTracks = [];
        }
      }
      render();
      void fetchPeek();
    });

    socket.on("player_buzz", (p: { playerName: string }) => {
      if (g.gamePhase === "registration") {
        g.buzzingPlayers = new Set([...g.buzzingPlayers, p.playerName]);
        render();
        setTimeout(() => {
          const next = new Set(g.buzzingPlayers);
          next.delete(p.playerName);
          g.buzzingPlayers = next;
          render();
        }, 1000);
        return;
      }
      if (g.gamePhase !== "song") return;
      g.latestBuzzer = p.playerName;
      nr.buzzElapsed = (performance.now() - nr.songStartTime) / 1000;
      render();
    });

    socket.on("player_added", (p: { playerName: string; deviceId: string }) => {
      const existing = g.players.find((pl) => pl.name === p.playerName);
      if (existing) existing.deviceId = p.deviceId;
      else
        g.players.push({ name: p.playerName, deviceId: p.deviceId, score: 0 });
      render();
    });

    socket.on("player_unlocked", (p: { playerName: string }) => {
      const pl = g.players.find((x) => x.name === p.playerName);
      if (pl) {
        pl.deviceId = "";
        render();
      }
    });

    socket.on("device_connected", (p: { deviceId: string }) => {
      g.connectedDevices = new Set([...g.connectedDevices, p.deviceId]);
      render();
    });

    socket.on("device_disconnected", (p: { deviceId: string }) => {
      const next = new Set(g.connectedDevices);
      next.delete(p.deviceId);
      g.connectedDevices = next;
      render();
    });

    socket.on("bump", (p: { player: string }) => {
      const pl = g.players.find((x) => x.name === p.player);
      if (pl) {
        pl.score++;
        render();
      }
    });

    socket.on("score_set", (p: { player: string; score: number }) => {
      const pl = g.players.find((x) => x.name === p.player);
      if (pl) {
        pl.score = p.score;
        render();
      }
    });

    socket.on(
      "remote_action",
      (p: {
        action: string;
        trackIndex?: string;
        enabled?: boolean;
        gainPct?: number;
      }) => {
        if (
          (p.action === "multi_score" || p.action === "multi_no_winner") &&
          p.trackIndex !== undefined
        ) {
          const idx = parseInt(p.trackIndex);
          if (g.multiTracks[idx]) {
            g.multiTracks[idx].removed = true;
            render();
          }
        }
        if (p.action === "mic_state_change") {
          if (p.enabled !== undefined) g.micEnabled = p.enabled;
          if (p.gainPct !== undefined) g.micGainPct = p.gainPct;
          render();
        }
      },
    );

    return () => {
      cancelAnimationFrame(nr.skipAnimFrame);
      cancelAnimationFrame(nr.nextAnimFrame);
      stopAnswerTimer();
      for (const ws of nr.buzzerSockets.values()) ws.close();
      nr.buzzerSockets.clear();
      document.removeEventListener("visibilitychange", onVisibility);
      if (nr.noSleepVideo) {
        nr.noSleepVideo.pause();
        nr.noSleepVideo.remove();
        nr.noSleepVideo = null;
      }
      if (nr.noSleepAudioCtx) {
        nr.noSleepAudioCtx.close().catch(() => {});
        nr.noSleepAudioCtx = null;
      }
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── gates ───────────────────────────────────────────────────────────────

  if (authStatus === "unauthenticated") return <LoginGate />;
  if (authStatus === "error")
    return <LoginGate message={authError || "auth error"} />;
  if (authStatus === "loading") {
    return (
      <div className="auth-overlay">
        <span className="auth-loading">…</span>
      </div>
    );
  }
  if (!authUser?.isAdmin) {
    return (
      <div className="auth-overlay">
        <span className="auth-error">ACCESS DENIED — admin only</span>
        <AuthBadge />
      </div>
    );
  }

  // ── derived ─────────────────────────────────────────────────────────────

  const itemLabel = (() => {
    const item = g.currentItem;
    if (!item) return "";
    if (item.type === "category")
      return item.category?.name ?? m["remote.modes.category"]();
    if (item.type === "song") {
      const mode = item.mode ?? "";
      const song = item.song;
      if (song?.artist && song?.title) return `${song.artist} - ${song.title}`;
      if (song?.label) return song.label;
      if (mode === "free") return m["remote.modes.question"]();
      if (mode === "fusion") return m["remote.modes.fusion"]();
      if (mode === "multi") return m["remote.modes.multi"]();
      if (mode === "slow") return m["remote.modes.slow"]();
      return m["remote.modes.song"]();
    }
    return "";
  })();

  const peekLabel = (() => {
    const p = g.peekInfo;
    if (!p) return "";
    if (p.finished) return m["remote.modes.end"]();
    if (p.type === "category") return `CAT: ${p.categoryName ?? "?"}`;
    if (p.type === "song") {
      if (p.songArtist && p.songTitle)
        return `${p.songArtist} - ${p.songTitle}`;
      return m["remote.modes.song"]();
    }
    return "";
  })();

  const phaseLabel = PHASE_LABELS[g.gamePhase]?.() ?? g.gamePhase.toUpperCase();
  const isSongPhase = ["song", "answering", "judging"].includes(g.gamePhase);
  const isTransportEnabled = ["song", "answering"].includes(g.gamePhase);
  const isPlayingActive = g.audioPlaying && !g.audioPaused;
  const canScore = ["song", "answering"].includes(g.gamePhase);
  const activeSessionName =
    g.sessions.find((s) => s.id === g.activeSessionId)?.name ?? "";
  const showSessionPicker = g.activeSessionId === 0 || g.sessionPickerOpen;
  const isDeviceConnected = (deviceId: string) =>
    !!deviceId && g.connectedDevices.has(deviceId);

  const holdHandlers = (start: () => void, end: () => void) => ({
    onTouchStart: (e: React.TouchEvent) => {
      e.preventDefault();
      start();
    },
    onTouchEnd: (e: React.TouchEvent) => {
      e.preventDefault();
      end();
    },
    onTouchCancel: (e: React.TouchEvent) => {
      e.preventDefault();
      end();
    },
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault();
      start();
    },
    onMouseUp: (e: React.MouseEvent) => {
      e.preventDefault();
      end();
    },
    onMouseLeave: () => end(),
  });

  const sessionPickerEl = (
    <SessionPicker
      sessions={g.sessions}
      activeId={g.activeSessionId}
      loading={g.sessionsLoading}
      error={g.sessionsError}
      selecting={g.sessionSelecting}
      progress={g.sessionProgress}
      onSelect={(id) => void selectSession(id)}
      onRefresh={() => void refreshSessions()}
    />
  );

  // ── render ──────────────────────────────────────────────────────────────

  return (
    <>
      <AuthBadge />
      <div
        className="remote-page"
        onTouchStart={ensureWakeLock}
        onMouseDown={ensureWakeLock}
      >
        {g.needsUnlock && (
          <div
            className="unlock-overlay"
            onTouchStart={(e) => {
              e.stopPropagation();
              void acquireWakeLock();
              g.needsUnlock = false;
              render();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              void acquireWakeLock();
              g.needsUnlock = false;
              render();
            }}
          >
            <div className="unlock-icon">🔓</div>
            <div className="unlock-label">{m["remote.tapToUnlock"]()}</div>
          </div>
        )}

        <div className="status-bar">
          <span className={`dot ${isConnected ? "on" : "off"}`} />
          <span className="phase">{phaseLabel}</span>
          {g.categoryName && (
            <span className="category-label">{g.categoryName}</span>
          )}
          <span className="build">{VERSION}</span>
        </div>

        <div className="tab-bar">
          {(
            [
              ["controls", m["remote.tabs.ctrl"]()],
              ["manual", m["remote.tabs.manual"]()],
              ["players", m["remote.tabs.setup"]()],
              ["buzzers", m["remote.tabs.buzz"]()],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              className={`tab${g.activeTab === tab ? " active" : ""}`}
              onClick={() => {
                g.activeTab = tab;
                render();
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {g.activeTab === "controls" && (
          <div className="tab-content">
            {g.activeSessionId !== 0 && (
              <div className="session-banner">
                <span className="session-banner-label">
                  {m["remote.session"]()}
                </span>
                <span className="session-banner-name">
                  {activeSessionName || `#${g.activeSessionId}`}
                </span>
                <button
                  className={`btn session-change-btn${g.sessionPickerOpen ? " open" : ""}`}
                  onClick={() => {
                    g.sessionPickerOpen = !g.sessionPickerOpen;
                    render();
                  }}
                >
                  {g.sessionPickerOpen
                    ? m["remote.cancel"]()
                    : m["remote.change"]()}
                </button>
              </div>
            )}

            {showSessionPicker ? (
              <div className="session-picker-wrapper">{sessionPickerEl}</div>
            ) : (
              <>
                <div className="current-item">
                  <div className="item-label">{itemLabel || phaseLabel}</div>
                </div>

                {g.preloading && (
                  <div className="preload-bar">
                    <span className="preload-text">
                      {m["remote.loading"]({
                        loaded: g.preloadLoaded,
                        total: g.preloadTotal,
                      })}
                    </span>
                    <div className="preload-track">
                      <div
                        className="preload-fill"
                        style={{ width: `${g.preloadProgress * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {g.preloadFailedPaths.length > 0 && (
                  <div className="preload-failed">
                    <div className="preload-failed-title">
                      {m["remote.preloadFailed"]()}
                    </div>
                    <ul className="preload-failed-list">
                      {g.preloadFailedPaths.map((path) => (
                        <li key={path} className="preload-failed-item">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {peekLabel && (
                  <div className="peek-bar">
                    {m["remote.next"]({ label: peekLabel })}
                  </div>
                )}

                <div className="transport">
                  <button
                    className="btn transport-btn icon-btn"
                    disabled={!isTransportEnabled}
                    aria-label={
                      isPlayingActive ? m["remote.pause"]() : m["remote.play"]()
                    }
                    onClick={() =>
                      sendAudioCommand(isPlayingActive ? "pause" : "play")
                    }
                  >
                    {isPlayingActive ? (
                      <svg
                        viewBox="0 0 24 24"
                        className="ctrl-icon"
                        aria-hidden="true"
                      >
                        <rect
                          x="6"
                          y="4"
                          width="4"
                          height="16"
                          rx="0.5"
                          fill="currentColor"
                        />
                        <rect
                          x="14"
                          y="4"
                          width="4"
                          height="16"
                          rx="0.5"
                          fill="currentColor"
                        />
                      </svg>
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        className="ctrl-icon"
                        aria-hidden="true"
                      >
                        <polygon
                          points="6,3.5 6,20.5 20,12"
                          fill="currentColor"
                        />
                      </svg>
                    )}
                  </button>
                  <button
                    className="btn transport-btn icon-btn"
                    disabled={!isTransportEnabled}
                    aria-label={m["remote.replay"]()}
                    onClick={() => sendAudioCommand("replay")}
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="ctrl-icon"
                      aria-hidden="true"
                    >
                      <path
                        d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <button
                    className={`btn transport-btn skip${g.skipHolding ? " holding" : ""}`}
                    disabled={!isSongPhase}
                    {...holdHandlers(skipTouchStart, skipTouchEnd)}
                  >
                    <span className="skip-label">
                      {g.skipHolding
                        ? m["remote.skipCountdown"]({
                            seconds: Math.ceil((1 - g.skipProgress) * 5),
                          })
                        : m["remote.holdSkip"]()}
                    </span>
                    {g.skipHolding && (
                      <div
                        className="skip-progress"
                        style={{ width: `${g.skipProgress * 100}%` }}
                      />
                    )}
                  </button>
                  <button
                    className={`btn transport-btn next${g.nextHolding ? " holding" : ""}`}
                    disabled={nextDisabled()}
                    {...holdHandlers(nextTouchStart, nextTouchEnd)}
                  >
                    <span className="next-label">
                      {g.nextHolding
                        ? m["remote.nextCountdown"]({
                            seconds: Math.ceil(1 - g.nextProgress),
                          })
                        : m["remote.nextBtn"]()}
                    </span>
                    {g.nextHolding && (
                      <div
                        className="next-hold-progress"
                        style={{ width: `${g.nextProgress * 100}%` }}
                      />
                    )}
                  </button>
                </div>

                <div className="gain-control">
                  <button
                    className={`btn mute-btn${g.isMuted ? " muted" : ""}`}
                    onClick={() => {
                      g.isMuted = !g.isMuted;
                      sendAudioCommand("set_gain", {
                        value: g.isMuted ? 0 : g.gainLevel / 100,
                      });
                      render();
                    }}
                  >
                    {g.isMuted ? m["remote.muted"]() : m["remote.vol"]()}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={g.gainLevel}
                    className="gain-slider"
                    onChange={(e) => {
                      g.gainLevel = Number(e.target.value);
                      g.isMuted = false;
                      sendAudioCommand("set_gain", {
                        value: g.gainLevel / 100,
                      });
                      render();
                    }}
                  />
                  <span className="gain-value">
                    {g.isMuted ? 0 : g.gainLevel}
                  </span>
                </div>

                <div className="gain-control">
                  <span className={`mic-badge${g.micEnabled ? " on" : ""}`}>
                    {g.micEnabled ? m["remote.micOn"]() : m["remote.micOff"]()}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={200}
                    value={g.micGainPct}
                    className="gain-slider mic-slider"
                    onChange={(e) => {
                      g.micGainPct = Number(e.target.value);
                      socket.send({
                        type: "remote_action",
                        payload: {
                          action: "set_mic_gain",
                          gainPct: g.micGainPct,
                        },
                      });
                      render();
                    }}
                  />
                  <span className="gain-value">{g.micGainPct}</span>
                </div>

                {g.latestBuzzer &&
                  (g.gamePhase === "answering" || g.gamePhase === "song") && (
                    <div className="answer-section">
                      <div className="answerer-name">
                        {g.latestBuzzer.toUpperCase()} (
                        {g.players.find((p) => p.name === g.latestBuzzer)
                          ?.score ?? 0}
                        )
                      </div>
                      {g.gamePhase === "answering" && (
                        <div
                          className={`answer-timer${g.answerRemaining <= 3 ? " low" : ""}`}
                        >
                          <div className="answer-timer-value">
                            {g.answerRemaining.toFixed(1)}S
                          </div>
                          <div className="answer-timer-track">
                            <div
                              className="answer-timer-fill"
                              style={{
                                width: `${(g.answerRemaining / 12) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      )}
                      <Button
                        className="btn good-btn"
                        onClick={() => void goodResponse()}
                      >
                        {m["remote.goodResponse"]()}
                      </Button>
                      <Button
                        className="btn bad-btn"
                        onClick={() => void badResponseAction()}
                      >
                        {m["remote.badResponse"]()}
                      </Button>
                    </div>
                  )}
              </>
            )}
          </div>
        )}

        {g.activeTab === "manual" && (
          <div className="tab-content">
            <div className="section-header">{m["remote.score"]()}</div>
            <div className="player-grid">
              {g.latestBuzzer && (
                <button
                  className="btn player-btn latest"
                  disabled={!canScore}
                  onClick={() => void scorePlayer(g.latestBuzzer!)}
                >
                  {m["remote.latest"]({ name: g.latestBuzzer.toUpperCase() })} (
                  {g.players.find((p) => p.name === g.latestBuzzer)?.score ?? 0}
                  )
                </button>
              )}
              {g.players.map((p) => (
                <button
                  key={p.deviceId || p.name}
                  className={`btn player-btn${p.name === g.latestBuzzer ? " answerer" : ""}`}
                  disabled={!canScore}
                  onClick={() => void scorePlayer(p.name)}
                >
                  {p.name.toUpperCase()} ({p.score})
                </button>
              ))}
              <button
                className="btn no-winner-btn"
                disabled={!canScore}
                onClick={noWinner}
              >
                {m["remote.noWinner"]()}
              </button>
            </div>
          </div>
        )}

        {g.activeTab === "players" && (
          <div className="tab-content">
            <div className="session-picker-wrapper">{sessionPickerEl}</div>

            <div className="section-header">{m["remote.addPlayer"]()}</div>
            <form
              className="add-player-form"
              onSubmit={(e) => {
                e.preventDefault();
                void addPlayer();
              }}
            >
              <Input
                className="name-input"
                type="text"
                maxLength={12}
                autoComplete="off"
                placeholder={m["remote.namePlaceholder"]()}
                value={g.newPlayerName}
                onChange={(e) => {
                  g.newPlayerName = e.target.value;
                  render();
                }}
              />
              <Button type="submit" className="btn add-btn">
                {m["remote.add"]()}
              </Button>
            </form>
            {g.createPlayerError && (
              <div className="error-msg">{g.createPlayerError}</div>
            )}

            <div className="registration-lock-row">
              <span className="registration-lock-label">
                {g.registrationLocked
                  ? m["remote.registrationLocked"]()
                  : m["remote.registrationOpen"]()}
              </span>
              <button
                className={`registration-lock-toggle${g.registrationLocked ? " on" : ""}`}
                disabled={!g.registrationLocked && g.players.length === 0}
                onClick={() =>
                  void setRegistrationLocked(!g.registrationLocked)
                }
                title={
                  g.registrationLocked
                    ? m["remote.registrationUnlockHint"]()
                    : m["remote.registrationLockHint"]()
                }
              >
                <span className="knob" />
              </button>
            </div>

            <div className="registration-lock-row">
              <span className="registration-lock-label">
                {m["remote.politenessDelay"]()}
              </span>
              <button
                className={`registration-lock-toggle${g.politenessEnabled ? " on" : ""}`}
                onClick={() => {
                  g.politenessEnabled = !g.politenessEnabled;
                  localStorage.setItem(
                    POLITENESS_KEY,
                    g.politenessEnabled ? "1" : "0",
                  );
                  sendPolitenessState();
                  render();
                }}
                title={m["remote.politenessDelayHint"]()}
              >
                <span className="knob" />
              </button>
            </div>

            <div className="section-header" style={{ marginTop: 16 }}>
              {m["remote.playersCount"]({ count: g.players.length })}
            </div>
            <div className="player-list">
              {g.players.map((p) => (
                <div
                  key={p.name}
                  className={`player-row${g.buzzingPlayers.has(p.name) ? " buzzing" : ""}`}
                >
                  <span className="player-name">{p.name}</span>
                  <span
                    className={`device-dot${isDeviceConnected(p.deviceId) ? " on" : ""}`}
                  >
                    {isDeviceConnected(p.deviceId) ? 1 : 0}
                  </span>
                  <span className="player-device">{p.deviceId || "—"}</span>
                  {p.deviceId && (
                    <button
                      className="btn unlock-btn"
                      onClick={() => void unlockPlayerDevice(p.name)}
                      title={m["remote.unlockDevice"]()}
                    >
                      ⇄
                    </button>
                  )}
                  <span className="score-label">{p.score}</span>
                  <button
                    className="btn edit-score-btn"
                    onClick={() => {
                      g.scoreEditorPlayer = p.name;
                      g.scoreEditorValue = p.score;
                      g.scoreEditorOpen = true;
                      render();
                    }}
                    title={m["remote.editScore"]()}
                  >
                    ✎
                  </button>
                  <button
                    className="btn punish-btn"
                    onClick={() => {
                      g.punishTarget = p.name;
                      g.punishConfirmOpen = true;
                      render();
                    }}
                    title={m["remote.punish"]()}
                  >
                    −2k
                  </button>
                </div>
              ))}
              {g.players.length === 0 && (
                <div className="empty-msg">{m["remote.noPlayersYet"]()}</div>
              )}
            </div>
          </div>
        )}

        {g.activeTab === "buzzers" && (
          <div className="tab-content">
            <div className="section-header">{m["remote.buzzers"]()}</div>
            <div className="buzzer-grid">
              {g.players.map((p) => (
                <button
                  key={`buzz-${p.deviceId || p.name}`}
                  className="btn buzzer-btn"
                  onClick={() => buzzPlayer(p.name)}
                  onTouchStart={(e) => {
                    e.preventDefault();
                    buzzPlayer(p.name);
                  }}
                >
                  {p.name.toUpperCase()}
                </button>
              ))}
              {g.players.length === 0 && (
                <div className="empty-msg">
                  {m["remote.noPlayersRegistered"]()}
                </div>
              )}
            </div>
          </div>
        )}

        {g.punishConfirmOpen && (
          <div
            className="score-editor-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                g.punishConfirmOpen = false;
                g.punishTarget = null;
                render();
              }
            }}
          >
            <div className="score-editor-box punish-box">
              <div className="score-editor-title">
                {g.punishTarget?.toUpperCase()}
              </div>
              <div className="punish-message">
                {m["remote.punishConfirm"]({
                  name: g.punishTarget?.toUpperCase() ?? "",
                })}
              </div>
              <div className="score-editor-actions">
                <button
                  className="btn score-editor-cancel"
                  onClick={() => {
                    g.punishConfirmOpen = false;
                    g.punishTarget = null;
                    render();
                  }}
                >
                  {m["remote.cancel"]()}
                </button>
                <button
                  className="btn punish-confirm-btn"
                  onClick={() => {
                    const name = g.punishTarget;
                    g.punishConfirmOpen = false;
                    g.punishTarget = null;
                    render();
                    if (name) {
                      const current =
                        g.players.find((pl) => pl.name === name)?.score ?? 0;
                      void setPlayerScore(name, current - PUNISH_AMOUNT);
                    }
                  }}
                >
                  {m["remote.confirm"]()}
                </button>
              </div>
            </div>
          </div>
        )}

        {g.scoreEditorOpen && (
          <div
            className="score-editor-overlay"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                g.scoreEditorOpen = false;
                g.scoreEditorPlayer = null;
                render();
              }
            }}
          >
            <div className="score-editor-box">
              <div className="score-editor-title">
                {g.scoreEditorPlayer?.toUpperCase()}
              </div>
              <input
                type="number"
                className="score-editor-input"
                value={g.scoreEditorValue}
                onChange={(e) => {
                  g.scoreEditorValue = Number(e.target.value);
                  render();
                }}
                onKeyUp={(e) => {
                  if (e.key === "Enter") applyScoreEditor();
                  if (e.key === "Escape") {
                    g.scoreEditorOpen = false;
                    g.scoreEditorPlayer = null;
                    render();
                  }
                }}
              />
              <div className="score-editor-actions">
                <button
                  className="btn score-editor-cancel"
                  onClick={() => {
                    g.scoreEditorOpen = false;
                    g.scoreEditorPlayer = null;
                    render();
                  }}
                >
                  {m["remote.cancel"]()}
                </button>
                <button
                  className="btn score-editor-apply"
                  onClick={applyScoreEditor}
                >
                  {m["remote.apply"]()}
                </button>
              </div>
            </div>
          </div>
        )}

        {g.showTrackPicker && (
          <div className="track-picker-overlay">
            <div className="track-picker-header">
              {g.pendingScorePlayer
                ? `${m["remote.score"]()}: ${g.pendingScorePlayer.toUpperCase()}`
                : m["remote.noWinner"]()}
            </div>
            <div className="track-picker-subtitle">
              {m["remote.selectTrackToRemove"]()}
            </div>
            <div className="track-picker-grid">
              {g.multiTracks.map((track, idx) => (
                <button
                  key={idx}
                  className={`btn track-pick-btn${track.removed ? " removed" : ""}`}
                  disabled={track.removed}
                  onClick={() => void pickMultiTrack(idx)}
                >
                  {track.title.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              className="btn track-pick-cancel"
              onClick={() => {
                g.showTrackPicker = false;
                g.pendingScorePlayer = null;
                render();
              }}
            >
              {m["remote.cancel"]()}
            </button>
          </div>
        )}
      </div>
    </>
  );

  function applyScoreEditor() {
    const player = g.scoreEditorPlayer;
    g.scoreEditorOpen = false;
    g.scoreEditorPlayer = null;
    render();
    if (player)
      void setPlayerScore(player, Math.round(Number(g.scoreEditorValue) || 0));
  }
}
