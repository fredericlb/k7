// Everything the host can DO from the remote: session choice, judging, scoring, simulated players.
// None of it sets a phase on its own — the server owns phases and announces them over the socket.

import { f } from "../lib/api";
import { ANSWER_DURATION, POLITENESS_KEY, type RemoteCtx } from "./state";

const JSON_HEADERS = { "Content-Type": "application/json" };

export function createActions(ctx: RemoteCtx) {
  const { g, nr, render, socket } = ctx;

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
        sessions?: typeof g.sessions;
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
        headers: JSON_HEADERS,
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

  const skip = () =>
    void f("/api/next", { method: "POST" }).catch((e) =>
      console.error("Failed /api/next (skip):", e),
    );

  async function setPlayerScore(playerName: string, score: number) {
    try {
      await f("/api/score/set", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ playerName, score }),
      });
      const p = g.players.find((pl) => pl.name === playerName);
      if (p) p.score = score;
      render();
    } catch (e) {
      console.error("Failed to set score:", e);
    }
  }

  async function postScore(playerName: string): Promise<boolean> {
    const res = await f("/api/score", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ playerName }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const p = g.players.find((pl) => pl.name === playerName);
    if (p) p.score = data.score;
    return true;
  }

  async function scorePlayer(playerName: string) {
    if (g.currentMode === "multi") {
      g.pendingScorePlayer = playerName;
      g.showTrackPicker = true;
      render();
      return;
    }
    try {
      if (await postScore(playerName)) render();
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

  async function badResponse() {
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
        await postScore(playerName);
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
      await f("/api/players/done", { method: "POST", headers: JSON_HEADERS });
    } catch {
      /* ignore */
    }
    await doNext();
  }

  const nextDisabled = () => {
    if (g.gamePhase === "registration" && g.players.length === 0) return true;
    if (["song", "answering", "judging"].includes(g.gamePhase)) return true;
    return false;
  };

  // The phase is read when the hold COMPLETES, not when it starts.
  function next() {
    if (g.gamePhase === "registration") void finishRegistrationAndStart();
    else void doNext();
  }

  // Simulated players hold REAL buzzer sockets, so the BUZZ tab takes the genuine pipeline.
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
        headers: JSON_HEADERS,
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

  function togglePoliteness() {
    g.politenessEnabled = !g.politenessEnabled;
    localStorage.setItem(POLITENESS_KEY, g.politenessEnabled ? "1" : "0");
    sendPolitenessState();
    render();
  }

  async function unlockPlayerDevice(playerName: string) {
    try {
      const res = await f("/api/players/unlock", {
        method: "POST",
        headers: JSON_HEADERS,
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

  return {
    stopAnswerTimer,
    setPhase,
    refreshSessions,
    selectSession,
    sendAction,
    sendAudioCommand,
    sendPolitenessState,
    skip,
    next,
    nextDisabled,
    setPlayerScore,
    scorePlayer,
    noWinner,
    goodResponse,
    badResponse,
    pickMultiTrack,
    fetchPeek,
    addPlayer,
    buzzPlayer,
    setRegistrationLocked,
    togglePoliteness,
    unlockPlayerDevice,
  };
}

export type RemoteActions = ReturnType<typeof createActions>;
