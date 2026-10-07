import { Alert, AlertTitle } from "@frediverse/ui/alert";
import { Badge } from "@frediverse/ui/badge";
import { TriangleAlert } from "@frediverse/ui/icons";
import { cn } from "@frediverse/ui/lib/utils";
import { Splash } from "@frediverse/ui/splash";
import { useEffect, useReducer, useRef, useSyncExternalStore } from "react";
import { AuthBadge } from "../components/AuthBadge";
import { BuzzButton } from "../components/BuzzButton";
import { UnlockDialog, WaitingSheet } from "../components/BuzzerOverlays";
import {
  LoginGate,
  NAME_CONFIRMED_KEY,
  NAME_KEY,
} from "../components/LoginGate";
import { useAuth } from "../lib/auth";
import { createWakeLock, type WakeLock } from "../lib/wakeLock";
import { BuzzerSocket } from "../lib/ws";
import { m } from "../paraglide/messages.js";

// WS state lives on a mutable ref plus a force-render: a useState closure would go stale here.

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

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

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
  }).current;
  const wakeLockRef = useRef<WakeLock | null>(null);
  wakeLockRef.current ??= createWakeLock();
  const wakeLock = wakeLockRef.current;

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

  function buzz() {
    if (!wakeLock.acquired()) void wakeLock.acquire();
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
    void wakeLock.acquire();
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

  // Re-checked on a connection change; the WS handlers below call it on their own transitions.
  useEffect(() => {
    tryAutoRegister();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  // ── socket wiring (once) ───────────────────────────────────────────────

  useEffect(() => {
    socket.connect();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        wakeLock.invalidate();
        void wakeLock.acquire();
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
      // Leaving with no result probably means "no winner", deferred so a score_set can cancel it.
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
      // The delta decides win or miss, and a second positive one accumulates in the same round.
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
        // A penalty lock mid-answer is a miss; "politeness" is not a penalty.
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
      wakeLock.dispose();
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
  if (authStatus === "loading") return <Splash label="Chargement" />;

  const isAnswering =
    !!g.playerName &&
    g.answeringName === g.playerName &&
    g.gamePhase === "answering";

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
        className="fixed inset-0 flex touch-manipulation flex-col items-center justify-center overflow-hidden bg-background font-['Press_Start_2P',monospace] select-none"
        onTouchStart={(e) => {
          e.preventDefault();
          buzz();
        }}
        onMouseDown={buzz}
      >
        <div className="absolute inset-x-0 top-6 flex justify-center">
          {!isConnected ? (
            <Badge variant="amber" className="animate-pulse">
              {m["buzzer.connecting"]()}
            </Badge>
          ) : g.deviceId ? (
            <Badge>
              {g.playerName ? `${g.deviceId}-${g.playerName}` : g.deviceId}
            </Badge>
          ) : null}
        </div>

        {g.playerName && (
          <div className="mb-8 flex items-center gap-3 text-lg tracking-widest text-green">
            {g.playerName.toUpperCase()}
            <Badge variant="amber" className="px-3 py-1 text-2xl">
              {g.playerScore}
            </Badge>
          </div>
        )}

        {g.buzzError ? (
          <Alert variant="destructive" className="mb-4 w-auto">
            <TriangleAlert />
            <AlertTitle className="animate-pulse">
              {m["buzzer.buzzTooEarly"]()}
            </AlertTitle>
          </Alert>
        ) : g.answeringName ? (
          <Badge variant="amber" className="mb-4 animate-pulse text-sm">
            {g.answeringName.toUpperCase()}
          </Badge>
        ) : null}

        <BuzzButton
          text={buzzText}
          isAnswering={isAnswering}
          locked={g.locked}
          politeness={g.lockReason === "politeness"}
          hasPlayer={!!g.playerName}
          pressed={g.buzzing}
          lockRemaining={g.lockRemaining}
        />

        {g.resultMessage && (
          <div
            className={cn(
              "mt-7 text-3xl tracking-widest animate-in fade-in zoom-in-50 duration-300",
              g.resultType === "win" && "text-green",
              g.resultType === "rate" && "text-destructive",
            )}
          >
            {g.resultMessage}
          </div>
        )}

        <div className="absolute bottom-10 text-[9px] text-muted-foreground">
          {g.playerName && <span>{m["buzzer.tapToScore"]()}</span>}
        </div>

        {/* Not a tap target: the page is the buzzer, and a span that swallowed taps would be a dead zone. */}
        <span className="pointer-events-none fixed bottom-1.5 left-1.5 text-[8px] text-muted-foreground/60">
          {VERSION}
        </span>
      </div>

      <UnlockDialog
        open={g.needsUnlock}
        label={m["buzzer.tapToUnlock"]()}
        onUnlock={unlock}
      />
      <WaitingSheet
        open={!g.needsUnlock && !g.playerName}
        label={
          g.gameReady && g.regStarted && !g.regComplete
            ? m["buzzer.joining"]()
            : m["buzzer.waitingForGame"]()
        }
        error={
          g.registerError === "waiting_for_game"
            ? m["buzzer.waitingForGame"]()
            : g.registerError
        }
      />
    </>
  );
}
