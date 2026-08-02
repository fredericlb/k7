import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { AuthBadge } from "../components/AuthBadge";
import {
  LoginGate,
  NAME_CONFIRMED_KEY,
  NAME_KEY,
} from "../components/LoginGate";
import { useAuth } from "../lib/auth";
import { BuzzerSocket } from "../lib/ws";
import { m } from "../paraglide/messages.js";

// The phone buzzer (port of BuzzerView.vue). All the imperative WS-driven
// state lives on a mutable ref (`g`) + force-render — the handlers arrive on
// socket callbacks, so plain useState closures would go stale.

const STORAGE_KEY = "buzzer_token";
const DEBOUNCE_MS = 500;
const ANSWER_DURATION_S = 12;

function getOrCreateToken(): string {
  let token = localStorage.getItem(STORAGE_KEY);
  if (!token) {
    try {
      token = crypto.randomUUID();
    } catch {
      // crypto.randomUUID() requires a secure context; fallback for HTTP.
      token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    localStorage.setItem(STORAGE_KEY, token);
  }
  return token;
}

export function BuzzerView() {
  const { status: authStatus, error: authError } = useAuth();
  const [, force] = useReducer((x: number) => x + 1, 0);
  const render = force as () => void;

  const socketRef = useRef<BuzzerSocket | null>(null);
  if (!socketRef.current) {
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    socketRef.current = new BuzzerSocket(
      `${wsProto}//${window.location.host}/ws/buzzer?token=${getOrCreateToken()}`,
    );
  }
  const socket = socketRef.current;
  const isConnected = useSyncExternalStore(
    socket.subscribe,
    socket.isConnected,
  );

  const g = useRef({
    deviceId: null as string | null,
    playerName: null as string | null,
    regComplete: false,
    regStarted: false,
    gameReady: false,
    lastBuzzTime: 0,
    buzzing: false,
    needsUnlock: true,
    locked: false,
    answeringName: null as string | null,
    playerScore: 0,
    lockRemaining: 0,
    lockReason: null as string | null,
    buzzError: null as string | null,
    registerError: "",
    nameConfirmed: sessionStorage.getItem(NAME_CONFIRMED_KEY) === "1",
    gamePhase: "",
    answerRemaining: 0,
    resultMessage: null as string | null,
    resultType: null as "win" | "rate" | null,
  }).current;

  const nr = useRef({
    serverTimeOffset: 0,
    lockedTimeout: null as number | null,
    lockCountdownInterval: null as number | null,
    lockEndTime: 0,
    pingInterval: null as number | null,
    answerStartTs: 0,
    answerAnimFrame: 0,
    resultTimeout: null as number | null,
    pointsThisRound: 0,
    wasAnswering: false,
    pendingRateTimeout: null as number | null,
    wakeLockAcquired: false,
    noSleepVideo: null as HTMLVideoElement | null,
    noSleepAudioCtx: null as AudioContext | null,
  }).current;

  // ── helpers ────────────────────────────────────────────────────────────

  const desiredName = (): string =>
    (localStorage.getItem(NAME_KEY) || "").trim();

  function stopAnswerTimer() {
    if (nr.answerAnimFrame) cancelAnimationFrame(nr.answerAnimFrame);
    nr.answerAnimFrame = 0;
    g.answerRemaining = 0;
    render();
  }

  function startAnswerTimer() {
    stopAnswerTimer();
    nr.answerStartTs = performance.now();
    g.answerRemaining = ANSWER_DURATION_S;
    const tick = () => {
      const elapsed = (performance.now() - nr.answerStartTs) / 1000;
      g.answerRemaining = Math.max(0, ANSWER_DURATION_S - elapsed);
      render();
      if (g.answerRemaining > 0)
        nr.answerAnimFrame = requestAnimationFrame(tick);
    };
    nr.answerAnimFrame = requestAnimationFrame(tick);
  }

  function clearPendingRate() {
    if (nr.pendingRateTimeout) {
      clearTimeout(nr.pendingRateTimeout);
      nr.pendingRateTimeout = null;
    }
  }

  function showResult(msg: string, type: "win" | "rate") {
    if (nr.resultTimeout) clearTimeout(nr.resultTimeout);
    g.resultMessage = msg;
    g.resultType = type;
    render();
    nr.resultTimeout = window.setTimeout(() => {
      g.resultMessage = null;
      g.resultType = null;
      nr.resultTimeout = null;
      nr.pointsThisRound = 0;
      render();
    }, 2000);
  }

  // Wake lock, three-tier: native API (HTTPS), silent canvas video (HTTP),
  // silent oscillator (last resort). Must be called during a user gesture.
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
        /* not available over HTTP — fall through */
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
        video.setAttribute("muted", "");
        video.muted = true;
        video.style.cssText =
          "position:fixed;top:-1px;left:-1px;width:1px;height:1px;opacity:0.01";
        video.srcObject = stream;
        document.body.appendChild(video);
        nr.noSleepVideo = video;
      } catch {
        /* captureStream not supported */
      }
    }
    if (nr.noSleepVideo) {
      try {
        await nr.noSleepVideo.play();
        nr.wakeLockAcquired = true;
        return;
      } catch {
        /* play blocked */
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
        /* AudioContext not supported */
      }
    }
  }

  function buzz() {
    if (!nr.wakeLockAcquired) void acquireWakeLock();
    if (!g.playerName) return; // must register first
    const now = Date.now();
    if (now - g.lastBuzzTime < DEBOUNCE_MS) return;
    g.lastBuzzTime = now;
    if (g.locked) return;
    g.buzzError = null;
    // Server-relative timestamp so the server prioritizes by actual buzz time.
    socket.send({
      type: "buzz",
      payload: { timestamp: now + nr.serverTimeOffset },
    });
    if (navigator.vibrate) navigator.vibrate(100);
    g.buzzing = true;
    render();
    setTimeout(() => {
      g.buzzing = false;
      render();
    }, 200);
  }

  function unlock() {
    void acquireWakeLock();
    g.needsUnlock = false;
    render();
  }

  function tryAutoRegister() {
    if (g.playerName) return;
    if (!socket.isConnected()) return;
    if (!g.gameReady || !g.regStarted || g.regComplete) return;
    if (!g.nameConfirmed) return;
    const name = desiredName();
    if (!name) return;
    g.registerError = "";
    socket.send({ type: "register", payload: { name } });
  }

  // Auto-register re-check on connection changes (the WS handlers below call
  // it directly on the relevant state transitions).
  useEffect(() => {
    tryAutoRegister();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // ── socket wiring (once) ───────────────────────────────────────────────

  useEffect(() => {
    socket.connect();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        nr.wakeLockAcquired = false; // native API releases on tab switch
        void acquireWakeLock();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    // Keep the connection warm through Cloudflare's 100s idle timeout.
    nr.pingInterval = window.setInterval(() => {
      if (socket.isConnected()) socket.send({ type: "ping", payload: {} });
    }, 30_000);

    socket.on(
      "welcome",
      (p: {
        deviceId: string;
        gameId: string;
        gameSelected?: boolean;
        registrationStarted?: boolean;
        registrationComplete: boolean;
        serverTimestamp: number;
      }) => {
        g.deviceId = p.deviceId;
        g.regComplete = p.registrationComplete;
        g.regStarted = Boolean(p.registrationStarted);
        g.gameReady = p.gameSelected !== false && Boolean(p.gameId);
        // offset = serverTimestamp − localNow ⇒ (Date.now() + offset) ≈ server time.
        nr.serverTimeOffset = p.serverTimestamp - Date.now();
        render();
        tryAutoRegister();
      },
    );

    socket.on(
      "game_selected",
      (p: {
        gameId: string;
        registrationStarted?: boolean;
        registrationComplete: boolean;
      }) => {
        g.gameReady = Boolean(p.gameId);
        g.regStarted = Boolean(p.registrationStarted);
        g.regComplete = p.registrationComplete;
        if (g.registerError === "waiting_for_game") g.registerError = "";
        render();
        tryAutoRegister();
      },
    );

    socket.on("no_game", () => {
      g.gameReady = false;
      g.regStarted = false;
      render();
    });

    socket.on(
      "registration_state",
      (p: { locked: boolean; started?: boolean }) => {
        g.regComplete = Boolean(p.locked);
        if (typeof p.started === "boolean") g.regStarted = p.started;
        else if (p.locked) g.regStarted = true;
        render();
        tryAutoRegister();
      },
    );

    socket.on("registered", (p: { playerName: string; score?: number }) => {
      g.playerName = p.playerName;
      if (typeof p.score === "number") g.playerScore = p.score;
      render();
    });

    socket.on("unregistered", () => {
      g.playerName = null;
      g.registerError = "";
      render();
      tryAutoRegister();
    });

    socket.on("register_error", (p: { error: string }) => {
      g.registerError = p.error;
      render();
    });

    socket.on("buzz_rejected", (p: { reason: string }) => {
      if (p.reason === "too_early") {
        g.buzzError = "buzz_too_early";
        render();
        setTimeout(() => {
          g.buzzError = null;
          render();
        }, 3000);
      }
    });

    socket.on("player_buzz", (p: { playerName: string }) => {
      g.answeringName = p.playerName;
      if (p.playerName === g.playerName) {
        nr.wasAnswering = true;
        nr.pointsThisRound = 0;
        startAnswerTimer();
      } else {
        stopAnswerTimer();
      }
      render();
    });

    socket.on("phase_change", (p: { phase: string }) => {
      const prev = g.gamePhase;
      g.gamePhase = p.phase;
      // Leaving answering/judging without a resolved result → probably "no
      // winner". Defer briefly so a bump/score_set can cancel this.
      if (
        nr.wasAnswering &&
        (prev === "answering" || prev === "judging") &&
        p.phase !== "answering" &&
        p.phase !== "judging"
      ) {
        clearPendingRate();
        nr.pendingRateTimeout = window.setTimeout(() => {
          nr.pendingRateTimeout = null;
          if (nr.wasAnswering) {
            showResult("RATÉ", "rate");
            nr.wasAnswering = false;
          }
        }, 300);
      }
      if (p.phase !== "answering") stopAnswerTimer();
      render();
    });

    socket.on("bump", (p: { player: string }) => {
      if (p.player === g.playerName) {
        g.playerScore++;
        render();
      }
    });

    socket.on("score_set", (p: { player: string; score: number }) => {
      if (p.player !== g.playerName) return;
      const delta = p.score - g.playerScore;
      g.playerScore = p.score;
      // Score delta on the answering player's buzzer decides win vs RATÉ; a
      // second positive delta (politeness bonus) accumulates the same round.
      if (delta > 0 && (nr.wasAnswering || nr.pointsThisRound > 0)) {
        nr.pointsThisRound += delta;
        clearPendingRate();
        showResult(`+${nr.pointsThisRound}`, "win");
        nr.wasAnswering = false;
      } else if (delta < 0 && nr.wasAnswering) {
        clearPendingRate();
        showResult("RATÉ", "rate");
        nr.wasAnswering = false;
      }
      render();
    });

    socket.on(
      "buzzer_locked",
      (p: { locked: boolean; durationMs?: number; reason?: string }) => {
        if (nr.lockedTimeout) {
          clearTimeout(nr.lockedTimeout);
          nr.lockedTimeout = null;
        }
        if (nr.lockCountdownInterval) {
          clearInterval(nr.lockCountdownInterval);
          nr.lockCountdownInterval = null;
        }
        g.locked = p.locked;
        g.lockRemaining = 0;
        g.lockReason = p.locked ? (p.reason ?? null) : null;
        if (!p.locked) g.answeringName = null;
        if (!p.locked || p.durationMs) stopAnswerTimer();
        // Per-device penalty lock while we were answering → RATÉ (but not for
        // non-penalty reasons like "politeness").
        if (
          p.locked &&
          p.durationMs &&
          nr.wasAnswering &&
          p.reason !== "politeness"
        ) {
          clearPendingRate();
          showResult("RATÉ", "rate");
          nr.wasAnswering = false;
        }
        if (p.locked && p.durationMs) {
          nr.lockEndTime = Date.now() + p.durationMs;
          g.lockRemaining = Math.ceil(p.durationMs / 1000);
          nr.lockCountdownInterval = window.setInterval(() => {
            const left = Math.ceil((nr.lockEndTime - Date.now()) / 1000);
            g.lockRemaining = Math.max(0, left);
            render();
            if (left <= 0 && nr.lockCountdownInterval) {
              clearInterval(nr.lockCountdownInterval);
              nr.lockCountdownInterval = null;
            }
          }, 200);
          nr.lockedTimeout = window.setTimeout(() => {
            g.locked = false;
            g.lockRemaining = 0;
            render();
          }, p.durationMs);
        }
        render();
      },
    );

    return () => {
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
      if (nr.lockedTimeout) clearTimeout(nr.lockedTimeout);
      if (nr.lockCountdownInterval) clearInterval(nr.lockCountdownInterval);
      if (nr.pingInterval) clearInterval(nr.pingInterval);
      if (nr.resultTimeout) clearTimeout(nr.resultTimeout);
      clearPendingRate();
      stopAnswerTimer();
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── render ─────────────────────────────────────────────────────────────

  if (authStatus === "unauthenticated") return <LoginGate />;
  if (authStatus === "error")
    return <LoginGate message={authError || "auth error"} />;
  if (authStatus === "authenticated" && !g.nameConfirmed) return <LoginGate />;
  if (authStatus === "loading") {
    return (
      <div className="auth-overlay">
        <span className="auth-loading">…</span>
      </div>
    );
  }

  const isAnswering =
    !!g.playerName &&
    g.answeringName === g.playerName &&
    g.gamePhase === "answering";

  const buzzClasses = [
    "buzz-button",
    g.buzzing && !g.locked ? "active" : "",
    (g.locked || !g.playerName) && !isAnswering ? "disabled" : "",
    isAnswering ? "answering" : "",
    g.locked && g.lockReason === "politeness" && !isAnswering
      ? "politeness"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const buzzText = isAnswering
    ? `${g.answerRemaining.toFixed(1)}S`
    : g.locked
      ? g.lockReason === "politeness"
        ? m["buzzer.politeness"]()
        : m["buzzer.locked"]()
      : m["buzzer.buzz"]();

  return (
    <>
      <AuthBadge />
      <div
        className="buzzer-page"
        onTouchStart={(e) => {
          e.preventDefault();
          buzz();
        }}
        onMouseDown={buzz}
      >
        <div className="status-bar">
          {!isConnected ? (
            <span className="status connecting">
              {m["buzzer.connecting"]()}
            </span>
          ) : g.deviceId ? (
            <span className="status connected">
              {g.playerName ? `${g.deviceId}-${g.playerName}` : g.deviceId}
            </span>
          ) : null}
        </div>

        {g.playerName && (
          <div className="player-label">
            {g.playerName.toUpperCase()}
            <span className="player-score">{g.playerScore}</span>
          </div>
        )}

        {g.buzzError ? (
          <div className="buzz-error">{m["buzzer.buzzTooEarly"]()}</div>
        ) : g.answeringName ? (
          <div className="answering-label">{g.answeringName.toUpperCase()}</div>
        ) : null}

        <div className={buzzClasses}>
          <span
            className={`buzz-text${g.locked && g.lockReason === "politeness" && !isAnswering ? " politeness-text" : ""}`}
          >
            {buzzText}
          </span>
          {g.locked && g.lockRemaining > 0 && !isAnswering && (
            <span className="lock-timer">{g.lockRemaining}s</span>
          )}
        </div>

        {g.resultMessage && (
          <div
            className={`result-message${g.resultType === "win" ? " bravo" : ""}${g.resultType === "rate" ? " rate" : ""}`}
          >
            {g.resultMessage}
          </div>
        )}

        <div className="hint">
          {g.playerName && <span>{m["buzzer.tapToScore"]()}</span>}
        </div>

        {g.needsUnlock ? (
          <div
            className="name-overlay"
            onTouchStart={(e) => {
              e.stopPropagation();
              unlock();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              unlock();
            }}
          >
            <div className="unlock-icon">🔓</div>
            <div className="name-label">{m["buzzer.tapToUnlock"]()}</div>
          </div>
        ) : !g.playerName ? (
          <div
            className="name-overlay"
            onTouchStart={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="name-form">
              <label className="name-label">
                {g.gameReady && g.regStarted && !g.regComplete
                  ? m["buzzer.joining"]()
                  : m["buzzer.waitingForGame"]()}
              </label>
              {g.registerError && (
                <div className="name-error">
                  {g.registerError === "waiting_for_game"
                    ? m["buzzer.waitingForGame"]()
                    : g.registerError}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
