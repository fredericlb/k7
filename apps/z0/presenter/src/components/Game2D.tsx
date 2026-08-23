import QRCode from "qrcode";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { charScaleForScore, drawCharacter } from "../canvas/drawCharacter";
import { drawGuitar, drawQuarterNote } from "../canvas/drawDecorations";
// Canvas draw functions
import {
  drawCategoryName,
  drawCorners,
  drawGrid,
  drawMusicNote,
  drawNoteField,
  drawParticles,
  F,
  glowText,
} from "../canvas/drawHelpers";
import { drawScoreboard } from "../canvas/drawScoreboard";
import { createCamera } from "../game/camera";
import { createCharacters } from "../game/characters";
import { createGlitch } from "../game/glitch";
import { GameLogic } from "../game/logic";
import { createParticles } from "../game/particles";
import { PresenterSocket } from "../lib/ws";
import { m } from "../paraglide/messages.js";
import type { GamePhase } from "../types/game";

const SCENE_EXTEND = 0.52;

// Build stamp baked in by the Dockerfile; "dev" anywhere it wasn't set.
const VERSION = import.meta.env.VITE_APP_VERSION ?? "dev";

// UI snapshot — the only state React renders; the draw loop reads the mutable game objects.
interface UIState {
  phase: GamePhase;
  songsLoading: boolean;
  progress: number;
  loaded: number;
  total: number;
}

function createPresenterSystem(getCanvas: () => HTMLCanvasElement | null) {
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

type PresenterSystem = ReturnType<typeof createPresenterSystem>;

export function Game2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sys] = useState<PresenterSystem>(() =>
    createPresenterSystem(() => canvasRef.current),
  );
  const ui = useSyncExternalStore(sys.uiStore.subscribe, sys.uiStore.get);

  // A discreet tick at t=9s, 10s and 11s of the 12 s answering window.
  useEffect(() => {
    if (ui.phase !== "answering") return;
    const timers = [9000, 10000, 11000].map((delay) =>
      window.setTimeout(sys.playTick, delay),
    );
    return () => {
      for (const id of timers) clearTimeout(id);
    };
  }, [ui.phase, sys]);

  useEffect(() => {
    const {
      logic,
      camera,
      particles,
      initParticles,
      updateGlitch,
      charStates,
      ensureCharState,
      updateCharacters,
    } = sys;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      initParticles(canvas.width, canvas.height * (1 + SCENE_EXTEND));
    }

    sys.ws.connect();

    // ─── Animation variables (draw loop only) ─────────────────────────────
    let ringAngle = 0;
    let note1Phase = 0;
    let note2Phase = Math.PI;
    let guitarWobble = 0;
    let answerCharX = -1;
    let answerCharY = -1;
    let answerCharScale = 1;
    let animId: number | null = null;
    let lastTime = performance.now() / 1000;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        animId = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        animId = requestAnimationFrame(draw);
        return;
      }

      const now = performance.now() / 1000;
      const dt = Math.min(now - lastTime, 0.05);
      lastTime = now;

      const W = canvas.width;
      const H = canvas.height;
      const sceneH = H * (1 + SCENE_EXTEND);
      const gamePhase = logic.gamePhase;

      if (particles.length === 0) initParticles(W, sceneH);

      // Camera
      const cameraVT = camera.updateCamera(now);

      // Misc updates
      ringAngle += dt * 2.5;
      void ringAngle;
      note1Phase += dt * 2.5;
      note2Phase += dt * 2.5;
      guitarWobble = Math.sin(now * 0.3) * 0.22;
      const noteBob = Math.sin(now * 0.4 + 0.8) * 7;
      const playerNames = Object.keys(logic.players);
      updateGlitch(dt, playerNames);
      const showChars = [
        "scoreboard",
        "category",
        "mystery-question",
        "song",
        "answering",
        "judging",
        "reveal",
      ].includes(gamePhase);
      for (const pn of playerNames) ensureCharState(pn, W);
      if (showChars) updateCharacters(dt, W);

      // Clear + background
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0f0c29");
      bg.addColorStop(1, "#302b63");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Scene-space rendering
      ctx.save();
      ctx.translate(0, -cameraVT);

      drawGrid(ctx, W, H, sceneH);
      drawParticles(ctx, particles, W, sceneH, dt);

      // Decorations (guitar, note, title)
      if (gamePhase === "registration") {
        drawGuitar(ctx, W * 0.76, H * 0.38, 1.42, guitarWobble, 0, 1);
        drawQuarterNote(ctx, W * 0.24, H * 0.38, 1.42, noteBob, 0, 1);

        glowText(ctx, m["game.title"](), W / 2, H * 0.32, "#ff00ff", 28, F(38));
        glowText(
          ctx,
          m["game.subtitle"](),
          W / 2,
          H * 0.47,
          "#ff00ff",
          12,
          F(16),
        );
      }

      ctx.restore();
      // End of scene-space rendering

      // Registration roster + QR code
      if (gamePhase === "registration") {
        const names = playerNames;

        // Buzzer-link QR (bottom-right corner).
        const qrImage = sys.getQrImage();
        if (qrImage?.complete) {
          const qrSize = Math.min(180, H * 0.28);
          const qrX = W - qrSize - 40;
          const qrY = H - qrSize - 60;
          ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
          glowText(
            ctx,
            "BUZZER",
            qrX + qrSize / 2,
            qrY - 16,
            "#00ffff",
            8,
            F(11),
          );
          glowText(
            ctx,
            sys.buzzerUrl,
            qrX + qrSize / 2,
            qrY + qrSize + 18,
            "#00ffff",
            6,
            F(9),
          );
        }

        // Wi-Fi QR bottom-left, with SSID and password readable for a phone that can't join.
        const wifiQRImage = sys.getWifiQRImage();
        if (wifiQRImage?.complete) {
          const qrSize = Math.min(180, H * 0.28);
          const qrX = 40;
          const qrY = H - qrSize - 60;
          ctx.drawImage(wifiQRImage, qrX, qrY, qrSize, qrSize);
          glowText(
            ctx,
            "WIFI",
            qrX + qrSize / 2,
            qrY - 16,
            "#ffcc00",
            8,
            F(11),
          );
          glowText(
            ctx,
            sys.wifiSSID,
            qrX + qrSize / 2,
            qrY + qrSize + 18,
            "#ffcc00",
            6,
            F(11),
          );
          glowText(
            ctx,
            sys.wifiPassword,
            qrX + qrSize / 2,
            qrY + qrSize + 36,
            "#ffcc00",
            4,
            F(9),
          );
        }

        const perRow = Math.min(4, Math.max(names.length, 1));
        const cellW = Math.min(200, (W * 0.7) / perRow);
        const rowH = 40;
        const numRows = Math.max(1, Math.ceil(names.length / perRow));
        const startX = W / 2 - ((perRow - 1) * cellW) / 2;
        const startY = H / 2 - ((numRows - 1) * rowH) / 2;
        for (let i = 0; i < names.length; i++) {
          const row = Math.floor(i / perRow);
          const col = i % perRow;
          const name = names[i];
          const isBuzzing = logic.buzzingPlayers.has(name);
          const color = isBuzzing ? "#00ff88" : "#ff00ff";
          const blur = isBuzzing ? 22 : 10;
          glowText(
            ctx,
            name.toUpperCase(),
            startX + col * cellW,
            startY + row * rowH,
            color,
            blur,
            F(16),
          );
        }

        if (names.length === 0) {
          glowText(
            ctx,
            m["game.waitingForPlayers"](),
            W / 2,
            H / 2,
            "#ffff00",
            14,
            F(14),
          );
        }
      }

      // Player characters (drawn before overlays so text appears on top)
      if (showChars) {
        const baseY = H - 55;
        const isAnswerPhase =
          (gamePhase === "answering" || gamePhase === "judging") &&
          logic.answeringPlayer;
        const ansName = logic.answeringPlayer?.name ?? "";
        const targetX = W / 2;
        const targetY = H * 0.52;
        const targetScale = 1.8;
        const lerpSpeed = 6;

        for (const name of playerNames) {
          const cs = charStates.get(name);
          if (!cs) continue;
          const score = logic.playerScores[name] ?? 0;
          const baseScale = charScaleForScore(score, logic.totalSongs, H);

          if (isAnswerPhase && name === ansName) {
            if (answerCharX < 0) {
              answerCharX = cs.x;
              answerCharY = baseY;
              answerCharScale = baseScale;
            }
            answerCharX +=
              (targetX - answerCharX) * Math.min(1, lerpSpeed * dt);
            answerCharY +=
              (targetY - answerCharY) * Math.min(1, lerpSpeed * dt);
            answerCharScale +=
              (targetScale - answerCharScale) * Math.min(1, lerpSpeed * dt);
            const savedX = cs.x;
            cs.x = answerCharX;
            drawCharacter(ctx, name, score, cs, answerCharY, answerCharScale);
            cs.x = savedX;
          } else {
            drawCharacter(ctx, name, score, cs, baseY, baseScale);
          }
        }

        if (!isAnswerPhase) {
          answerCharX = -1;
          answerCharY = -1;
          answerCharScale = 1;
        }
      }

      // Screen-space elements
      if (
        !["scoreboard", "category", "mystery-question", "song", "end"].includes(
          gamePhase,
        )
      ) {
        drawCorners(ctx, W, H, 1);
      }

      // Scoreboard (between categories)
      if (gamePhase === "scoreboard") {
        const sorted = Object.keys(logic.players)
          .map((n) => ({ name: n, score: logic.playerScores[n] ?? 0 }))
          .sort((a, b) => b.score - a.score);
        glowText(
          ctx,
          m["game.topCharts"](),
          W / 2,
          H * 0.1,
          "#ffff00",
          18,
          F(18),
        );
        drawScoreboard(ctx, W, H, H * 0.22, H * 0.56, sorted, charStates);
      }

      // Category
      if (gamePhase === "category") {
        const name = logic.currentItem?.category?.name ?? "";
        const notice = logic.currentItem?.category?.notice;
        glowText(
          ctx,
          m["game.categoryLabel"](),
          W / 2,
          H * 0.2,
          "#00ffff",
          14,
          F(16),
        );
        drawCategoryName(ctx, name, W / 2, H * 0.42, W * 0.82);
        if (notice)
          glowText(ctx, notice, W / 2, H * 0.54, "#ffff00", 10, F(12));
      }

      // Mystery question
      if (gamePhase === "mystery-question") {
        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.fillRect(0, 0, W, H);
        glowText(
          ctx,
          m["game.mysteryQuestion"](),
          W / 2,
          H * 0.42,
          "#ff00ff",
          28,
          F(28),
        );
        glowText(
          ctx,
          m["game.pressToContinue"](),
          W / 2,
          H * 0.62,
          "#555",
          4,
          F(9),
        );
      }

      // Pause
      if (gamePhase === "pause") {
        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.fillRect(0, 0, W, H);
        glowText(ctx, m["game.pause"](), W / 2, H * 0.42, "#ffff00", 28, F(28));
        glowText(
          ctx,
          m["game.pressToContinue"](),
          W / 2,
          H * 0.62,
          "#555",
          4,
          F(9),
        );
      }

      // Song
      if (gamePhase === "song") {
        const mode = logic.getCurrentMode();
        if (mode === "free") {
          glowText(
            ctx,
            m["game.questionNumber"]({ n: logic.getQuestionNumber() }),
            W / 2,
            H * 0.42,
            "#00ffff",
            18,
            F(28),
          );
        } else if (mode === "multi") {
          glowText(
            ctx,
            m["game.multi"](),
            W / 2,
            H * 0.18,
            "#ffff00",
            18,
            F(18),
          );
          const tracks = logic.currentItem?.song?.tracks ?? [];
          const removed = logic.multiRemovedTracks;
          const lineH = Math.min(36, (H * 0.5) / Math.max(tracks.length, 1));
          const startY = H * 0.28;
          for (let i = 0; i < tracks.length; i++) {
            const isRemoved = removed.has(i);
            const title = tracks[i]?.title;
            const label =
              isRemoved && title
                ? title.toUpperCase()
                : m["game.track"]({ n: i + 1 });
            const color = isRemoved ? "#444" : "#00ffff";
            const blur = isRemoved ? 2 : 10;
            glowText(
              ctx,
              (isRemoved ? "✗ " : "♪ ") + label,
              W / 2,
              startY + i * lineH,
              color,
              blur,
              F(12),
            );
          }
          // Show last removed flash
          const lastR = logic.multiLastRemoved;
          if (lastR) {
            const winner = lastR.playerName;
            ctx.fillStyle = "rgba(0,0,0,0.6)";
            ctx.fillRect(W * 0.1, H * 0.7, W * 0.8, H * 0.15);
            if (winner) {
              glowText(
                ctx,
                m["game.playerTrack"]({
                  player: winner.toUpperCase(),
                  n: lastR.trackIndex + 1,
                }),
                W / 2,
                H * 0.78,
                "#00ff88",
                14,
                F(14),
              );
            } else {
              glowText(
                ctx,
                m["game.trackRemoved"]({ n: lastR.trackIndex + 1 }),
                W / 2,
                H * 0.78,
                "#ff4444",
                14,
                F(14),
              );
            }
          }
        } else if (mode === "fusion") {
          drawNoteField(ctx, W, H, note1Phase);
          drawMusicNote(ctx, "♪", W / 2 - 80, H * 0.36, "#ff00ff", note1Phase);
          drawMusicNote(ctx, "♫", W / 2 + 80, H * 0.36, "#00ffff", note2Phase);
          glowText(
            ctx,
            m["game.fusion"](),
            W / 2,
            H * 0.5,
            "#ffff00",
            18,
            F(18),
          );
        } else if (mode === "reversed") {
          drawNoteField(ctx, W, H, note1Phase);
          drawMusicNote(ctx, "♪", W / 2 - 80, H * 0.36, "#ff00ff", note1Phase);
          drawMusicNote(ctx, "♫", W / 2 + 80, H * 0.36, "#00ffff", note2Phase);
          glowText(
            ctx,
            m["game.reverse"](),
            W / 2,
            H * 0.5,
            "#ff4444",
            14,
            F(14),
          );
        } else if (mode === "slow") {
          drawNoteField(ctx, W, H, note1Phase, 0.2);
          drawMusicNote(
            ctx,
            "♪",
            W / 2 - 80,
            H * 0.36,
            "#ff00ff",
            note1Phase * 0.2,
          );
          drawMusicNote(
            ctx,
            "♫",
            W / 2 + 80,
            H * 0.36,
            "#00ffff",
            note2Phase * 0.2,
          );
          glowText(ctx, m["game.slow"](), W / 2, H * 0.5, "#ff8800", 14, F(18));
        } else {
          const hasAudio = !!logic.currentItem?.song?.path;
          if (hasAudio) {
            drawNoteField(ctx, W, H, note1Phase);
            drawMusicNote(
              ctx,
              "♪",
              W / 2 - 80,
              H * 0.36,
              "#ff00ff",
              note1Phase,
            );
            drawMusicNote(
              ctx,
              "♫",
              W / 2 + 80,
              H * 0.36,
              "#00ffff",
              note2Phase,
            );
          } else {
            glowText(
              ctx,
              m["game.questionNumber"]({ n: logic.getQuestionNumber() }),
              W / 2,
              H * 0.42,
              "#00ffff",
              18,
              F(28),
            );
          }
        }

        // Song notice
        const songNotice = logic.currentItem?.song?.notice;
        if (songNotice) {
          glowText(ctx, songNotice, W / 2, H * 0.22, "#ffff00", 10, F(12));
        }

        // Skip-hold progress
        const skipHoldStart = logic.getSkipHoldStart();
        if (skipHoldStart >= 0) {
          const skipElapsed = now - skipHoldStart;
          const skipProgress = Math.min(
            skipElapsed / logic.getSkipHoldDuration(),
            1,
          );
          const cx = W / 2,
            cy = H * 0.65,
            r = 30;

          ctx.save();
          ctx.strokeStyle = "rgba(255,255,0,0.15)";
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = "#ffff00";
          ctx.shadowColor = "#ffff00";
          ctx.shadowBlur = 12;
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(
            cx,
            cy,
            r,
            -Math.PI / 2,
            -Math.PI / 2 + Math.PI * 2 * skipProgress,
          );
          ctx.stroke();
          glowText(ctx, m["game.skip"](), cx, cy, "#ffff00", 8, F(9));
          ctx.restore();

          if (skipProgress >= 1) {
            logic.setSkipHoldStart(-1);
            logic.callNext();
          }
        }
      } else {
        logic.setSkipHoldStart(-1);
      }

      // Song timecode, pinned at 0:00: playback runs on monitor-web, so local audio time is gone.
      if (["song", "answering", "judging", "reveal"].includes(gamePhase)) {
        const tc = 0;
        const mins = Math.floor(tc / 60);
        const secs = Math.floor(tc % 60);
        const timecode = `${mins}:${secs.toString().padStart(2, "0")}`;
        ctx.save();
        ctx.globalAlpha = 0.5;
        glowText(ctx, timecode, 20, H - 20, "#00ffff", 4, F(10), "left");
        ctx.restore();
      }

      // End screen
      if (gamePhase === "end") {
        const sorted = Object.keys(logic.players)
          .map((n) => ({ name: n, score: logic.playerScores[n] ?? 0 }))
          .sort((a, b) => b.score - a.score);
        glowText(
          ctx,
          m["game.theEnd"](),
          W / 2,
          H * 0.12,
          "#ffff00",
          34,
          F(42),
        );
        drawScoreboard(ctx, W, H, H * 0.24, H * 0.58, sorted, charStates);
      }

      // Answering phase overlay
      if (gamePhase === "answering" && logic.answeringPlayer) {
        ctx.fillStyle = "rgba(0,0,0,0.72)";
        ctx.fillRect(0, 0, W, H);

        const pname = logic.answeringPlayer.name;
        const nameSize = Math.min(
          52,
          Math.floor(W / (Math.max(pname.length, 5) * 1.4)),
        );
        glowText(
          ctx,
          pname.toUpperCase(),
          W / 2,
          H * 0.34,
          "#00ff88",
          32,
          F(nameSize),
        );
        glowText(ctx, m["game.buzzed"](), W / 2, H * 0.5, "#ffff00", 14, F(20));
        glowText(ctx, m["game.judgeHint"](), W / 2, H * 0.84, "#555", 4, F(9));
      }

      // Judging phase overlay
      if (gamePhase === "judging") {
        ctx.fillStyle = "rgba(0,0,0,0.88)";
        ctx.fillRect(0, 0, W, H);

        glowText(
          ctx,
          m["game.judgment"](),
          W / 2,
          H * 0.1,
          "#ffff00",
          28,
          F(32),
        );

        const pnames = Object.keys(logic.players);
        const lineH = Math.min(52, (H * 0.62) / Math.max(pnames.length, 1));
        const startY = H * 0.22;
        const judgingInput = logic.getJudgingInput();

        for (let i = 0; i < pnames.length; i++) {
          const pn = pnames[i];
          const deviceId = logic.players[pn] ?? "";
          const isAnswerer = pn === logic.answeringPlayer?.name;
          const isSelected =
            judgingInput !== "" && parseInt(judgingInput) - 1 === i;
          const color = isSelected
            ? "#ff00ff"
            : isAnswerer
              ? "#00ff88"
              : "#00ffff";
          const blur = isAnswerer || isSelected ? 20 : 6;
          const size = isAnswerer || isSelected ? 17 : 14;
          glowText(
            ctx,
            `${i + 1}.  ${pn.toUpperCase()}  (${deviceId})`,
            W / 2,
            startY + i * lineH,
            color,
            blur,
            F(size),
          );
        }

        const selName =
          judgingInput !== ""
            ? (Object.keys(logic.players)[parseInt(judgingInput) - 1] ?? "?")
            : (logic.answeringPlayer?.name ?? "?");
        glowText(
          ctx,
          `▶  ${selName.toUpperCase()}`,
          W / 2,
          H * 0.82,
          "#ff00ff",
          18,
          F(18),
        );

        const hint =
          judgingInput !== ""
            ? m["game.judgeConfirmHint"]()
            : m["game.judgeSelectHint"]();
        glowText(ctx, hint, W / 2, H * 0.91, "#444", 4, F(8));
      }

      // Reveal phase overlay
      if (gamePhase === "reveal" && logic.currentItem?.song) {
        ctx.fillStyle = "rgba(0,0,0,0.78)";
        ctx.fillRect(0, 0, W, H);

        const song = logic.currentItem.song;
        const winner = logic.revealWinner ?? "";
        const mode = logic.getCurrentMode();

        if (mode === "fusion") {
          const tracks = song.tracks ?? [];
          const label =
            song.label || tracks.map((tr) => tr.title ?? "").join(" + ");
          glowText(
            ctx,
            label.toUpperCase(),
            W / 2,
            H * 0.22,
            "#00ffff",
            28,
            F(28),
          );
          if (tracks[0]?.title)
            glowText(
              ctx,
              tracks[0].title.toUpperCase(),
              W / 2,
              H * 0.33,
              "#ff00ff",
              14,
              F(16),
            );
          if (tracks[1]?.title)
            glowText(
              ctx,
              tracks[1].title.toUpperCase(),
              W / 2,
              H * 0.41,
              "#ff00ff",
              14,
              F(16),
            );
        } else {
          glowText(
            ctx,
            song.title.toUpperCase(),
            W / 2,
            H * 0.22,
            "#00ffff",
            28,
            F(32),
          );
          glowText(
            ctx,
            song.artist.toUpperCase(),
            W / 2,
            H * 0.35,
            "#ff00ff",
            18,
            F(22),
          );
        }

        if (winner === "__no_winner__") {
          glowText(
            ctx,
            m["game.tooBad"](),
            W / 2,
            H * 0.6,
            "#ff4444",
            32,
            F(40),
          );
        } else if (winner) {
          glowText(
            ctx,
            m["game.bravo"](),
            W / 2,
            H * 0.54,
            "#ffff00",
            14,
            F(16),
          );
          const nameSize = Math.min(
            48,
            Math.floor(W / (Math.max(winner.length, 5) * 1.4)),
          );
          glowText(
            ctx,
            winner.toUpperCase(),
            W / 2,
            H * 0.66,
            "#00ff88",
            32,
            F(nameSize),
          );
        }

        glowText(
          ctx,
          m["game.pressToContinue"](),
          W / 2,
          H * 0.88,
          "#555",
          4,
          F(9),
        );
      }

      // Category notice, drawn last so it sits on top of the overlays.
      if (
        ["song", "answering", "judging", "reveal"].includes(gamePhase) &&
        logic.categoryNotice
      ) {
        glowText(
          ctx,
          logic.categoryNotice,
          W / 2,
          H * 0.08,
          "#ffff00",
          10,
          F(12),
        );
      }

      animId = requestAnimationFrame(draw);
    };

    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      initParticles(canvas.width, canvas.height * (1 + SCENE_EXTEND));
    };

    // No AudioContext here, so no user gesture is needed: auto-resume, or open registration.
    void (async () => {
      const info = await logic.checkResumable();
      if (info && logic.showResumeOption && info.phase) {
        await logic.resumeGame(info.phase);
      } else {
        await logic.startGame();
      }
    })();

    lastTime = performance.now() / 1000;
    animId = requestAnimationFrame(draw);
    window.addEventListener("resize", handleResize);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
      sys.sendAudio("stop");
      sys.ws.disconnect();
    };
  }, [sys]);

  const progressPercent = Math.round(ui.progress * 100);
  const waitingForRemote =
    !["song", "loading"].includes(ui.phase) && !ui.songsLoading;

  return (
    <div className="game-wrap">
      {/* Main canvas */}
      <canvas ref={canvasRef} className="game-canvas" />

      {/* CRT overlay: scanlines + vignette */}
      <div className="crt-scanlines" aria-hidden="true" />
      <div className="crt-vignette" aria-hidden="true" />

      {/* Loading overlay (shown during category when songs are still loading) */}
      {ui.songsLoading &&
        (ui.phase === "category" || ui.phase === "scoreboard") && (
          <div className="loading-overlay">
            <div className="loading-content">
              <span className="loading-title">CHARGEMENT</span>
              <div className="progress-bar-outer">
                <div
                  className="progress-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="loading-detail">
                {ui.loaded} / {ui.total} sons chargés — {progressPercent}%
              </span>
            </div>
          </div>
        )}

      {/* Waiting for remote indicator */}
      {waitingForRemote && (
        <div className="waiting-remote">{m["game.waitingForRemote"]()}</div>
      )}

      <div className="build">{VERSION}</div>
    </div>
  );
}
