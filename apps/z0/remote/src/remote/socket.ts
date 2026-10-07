// What the remote LEARNS: the first snapshot from /api/game, then every socket message after it.
// Handlers are registered once, so they read the shared state bag rather than closing over render-time values.

import { f } from "../lib/api";
import type { RemoteActions } from "./actions";
import type { RemoteCtx } from "./state";

export async function hydrate(ctx: RemoteCtx, a: RemoteActions) {
  const { g, render } = ctx;
  try {
    const res = await f("/api/game");
    const info = await res.json();
    g.registrationLocked = Boolean(info.registrationComplete);
    if (info.players?.length > 0) {
      // biome-ignore lint/suspicious/noExplicitAny: the snapshot's players are untyped server rows.
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
      if (info.currentItem.finished) a.setPhase("end");
      else if (info.currentItem.type === "category") a.setPhase("category");
      else if (info.currentItem.type === "song") {
        // The authoritative phase wins mid-song, or a refresh during reveal collapses to "song".
        if (
          info.phase &&
          ["answering", "judging", "reveal"].includes(info.phase)
        )
          a.setPhase(info.phase);
        else a.setPhase("song");
      }
    } else if (info.phase) {
      a.setPhase(info.phase);
    } else {
      a.setPhase("registration");
    }
    render();
  } catch {
    /* ignore */
  }
  await a.fetchPeek();
}

export function wireSocket(ctx: RemoteCtx, a: RemoteActions) {
  const { g, nr, render, socket } = ctx;

  socket.on("connected", () => a.sendPolitenessState());

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
      void a.refreshSessions();
    }
  });

  socket.on("registration_state", (p: { locked: boolean }) => {
    g.registrationLocked = Boolean(p.locked);
    render();
  });

  socket.on("phase_change", (p: { phase?: string }) => {
    if (p.phase) a.setPhase(p.phase);
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

  // biome-ignore lint/suspicious/noExplicitAny: the round item arrives untyped from the server.
  socket.on("next", (payload: any) => {
    g.currentItem = payload;
    g.currentMode = payload.mode ?? "";
    if (payload.finished) {
      a.setPhase("end");
    } else if (payload.type === "category") {
      g.categoryName = payload.category?.name ?? "";
      a.setPhase("category");
    } else if (payload.type === "song") {
      a.setPhase("song");
      g.latestBuzzer = null;
      nr.songStartTime = performance.now();
      g.showTrackPicker = false;
      if (payload.mode === "multi" && payload.song?.tracks) {
        // biome-ignore lint/suspicious/noExplicitAny: the round item arrives untyped from the server.
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
    void a.fetchPeek();
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
    else g.players.push({ name: p.playerName, deviceId: p.deviceId, score: 0 });
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
        const idx = parseInt(p.trackIndex, 10);
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
}
