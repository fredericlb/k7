import { f } from "./api";
import type { AudioPlayback } from "./audioPlayback";
import type { Player, WSMessage, WSSubscriber } from "./monitor";

// Framework-free port of composables/useGameState.ts. Pure side-effect
// module: it consumes WS traffic (next / phase_change / player_buzz /
// remote_action) and drives reveal audio, buzzer locks, the politeness
// bonus, and multi-track state broadcasts. Nothing here renders — the
// monitor UI shows phase/players from MonitorClient — so no snapshot store.

export interface GameStateDeps {
  subscribe: (fn: WSSubscriber) => () => void;
  sendWS: (msg: { type: string; payload: unknown }) => void;
  getPlayers: () => Player[];
  audio: AudioPlayback;
}

const PLAYER_COOLDOWN_MS = 10000;
const POLITENESS_BONUS_PER_STREAK = 150;
const calcPolitenessDurationMs = (streak: number): number =>
  streak <= 0 ? 0 : (1 + streak) * 1000;

export class GameState {
  // Phase mirror — set when monitor-web drives transitions.
  private phase = "";
  // Reveal state, broadcast as `reveal_state`.
  private revealWinner: string | null = null;
  // Multi-track state, broadcast as `multi_state`.
  private multiRemovedTracks = new Set<number>();
  private multiLastRemoved: {
    trackIndex: number;
    playerName: string | null;
  } | null = null;
  // Tracked locally so badResponse can lock the right device.
  private answeringPlayer: { name: string; deviceId: string } | null = null;

  // Win streak / politeness state.
  private winStreakPlayer: string | null = null;
  private winStreakCount = 0;
  private pendingPoliteness: {
    playerName: string;
    durationMs: number;
    streakCount: number;
  } | null = null;
  private activePoliteness: { playerName: string; streakCount: number } | null =
    null;
  private politenessEnabled = true;
  private multiRevealTimer: number | null = null;

  private deps: GameStateDeps;
  private wsUnsub: () => void;

  constructor(deps: GameStateDeps) {
    this.deps = deps;
    this.wsUnsub = deps.subscribe((msg) => this.onMessage(msg));
  }

  private findDeviceId(name: string): string | undefined {
    return this.deps.getPlayers().find((p) => p.name === name)?.deviceId;
  }

  private findScore(name: string): number {
    return this.deps.getPlayers().find((p) => p.name === name)?.score ?? 0;
  }

  private broadcastReveal(): void {
    this.deps.sendWS({
      type: "reveal_state",
      payload: { winner: this.revealWinner },
    });
  }

  private broadcastMulti(): void {
    this.deps.sendWS({
      type: "multi_state",
      payload: {
        removedTracks: [...this.multiRemovedTracks],
        lastRemoved: this.multiLastRemoved,
      },
    });
  }

  // Local-only phase setter. Phase ownership lives on the remote — every
  // other client (monitor, presenter, buzzer) consumes phase_change but
  // does not publish it. We still track phase so monitor-internal logic
  // (audio timing, buzz gating) reacts immediately; the remote will
  // broadcast its own phase_change in response to the same remote_action.
  private setPhase(p: string): void {
    this.phase = p;
  }

  private clearMultiRevealTimer(): void {
    if (this.multiRevealTimer !== null) {
      clearTimeout(this.multiRevealTimer);
      this.multiRevealTimer = null;
    }
  }

  private callNextBackend(): void {
    f("/api/next", { method: "POST" }).catch((e) =>
      console.error("Failed /api/next:", e),
    );
  }

  /**
   * Reveal + politeness side-effects. The caller (remote/presenter) is
   * responsible for POSTing `/api/score`; monitor-web just drives audio,
   * reveal state, and the politeness bonus.
   */
  private handleScoreAndReveal(playerName: string): void {
    this.revealForPlayer(playerName);
  }

  private handleNoWinner(): void {
    this.revealForPlayer("__no_winner__");
  }

  private revealForPlayer(playerName: string): void {
    const audio = this.deps.audio;
    // Politeness streak/bonus.
    if (playerName === "__no_winner__") {
      this.winStreakPlayer = null;
      this.winStreakCount = 0;
    } else {
      if (
        this.activePoliteness &&
        this.activePoliteness.playerName === playerName &&
        this.activePoliteness.streakCount > 0
      ) {
        const bonus =
          POLITENESS_BONUS_PER_STREAK * this.activePoliteness.streakCount;
        const current = this.findScore(playerName);
        f("/api/score/set", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName, score: current + bonus }),
        }).catch((e) => console.error("Politeness bonus failed:", e));
      }
      if (this.winStreakPlayer === playerName) this.winStreakCount++;
      else {
        this.winStreakPlayer = playerName;
        this.winStreakCount = 1;
      }
      if (this.politenessEnabled) {
        const durationMs = calcPolitenessDurationMs(this.winStreakCount);
        if (durationMs > 0) {
          this.pendingPoliteness = {
            playerName,
            durationMs,
            streakCount: this.winStreakCount,
          };
        }
      }
    }

    this.revealWinner = playerName;
    this.broadcastReveal();

    // Reveal audio: play the full song from where the clip was.
    const item = audio.currentItem;
    const song = item?.song;
    const from = song?.from ?? 0;
    const mode = audio.currentMode;
    audio.preloader.stop();
    audio.preloader.setEffects({});
    audio.preloader.setPlaybackRate(1);
    if (mode === "free") {
      const path = song?.fullSong ?? song?.path;
      if (path) void audio.preloader.play(path, from);
    } else if (mode === "fusion") {
      const path = song?.fullSong ?? song?.tracks?.[0]?.path;
      if (path) void audio.preloader.play(path, from);
    } else {
      const path = song?.fullSong ?? song?.path;
      if (path) void audio.preloader.play(path, from);
    }
    audio.preloader.setGain(0.7 * audio.masterGain);
    this.setPhase("reveal");
  }

  /** Bad response: resume song audio, lock the offender, unlock buzzers. */
  private handleBadResponse(): void {
    const audio = this.deps.audio;
    const item = audio.currentItem;
    const song = item?.song;
    const songFrom = song?.from ?? 0;
    const songTo = song?.to ?? 0;
    const mode = audio.currentMode;
    if (mode === "multi") {
      // Audio never stopped.
    } else if (mode === "free") {
      // No audio.
    } else if (mode === "reversed") {
      if (song?.path)
        void audio.preloader.playReversed(song.path, songFrom, songTo);
    } else if (mode === "fusion") {
      // Re-trigger fusion alternation by replaying via 'next'-style logic.
      // We only have play/playReversed exposed; resume the first track.
      const tracks = song?.tracks ?? [];
      if (tracks.length >= 1 && tracks[0].path) {
        void audio.preloader.play(
          tracks[0].path,
          tracks[0].from ?? songFrom,
          tracks[0].to ?? songTo,
        );
      }
    } else if (mode === "one") {
      if (song?.path) void audio.preloader.play(song.path, songFrom, songTo);
    } else {
      if (song?.path) void audio.preloader.resume(song.path);
    }
    if (this.answeringPlayer) {
      this.deps.sendWS({
        type: "lock_device",
        payload: {
          deviceId: this.answeringPlayer.deviceId,
          durationMs: PLAYER_COOLDOWN_MS,
        },
      });
    }
    this.answeringPlayer = null;
    this.setPhase("song");
  }

  private finishMultiStep(): void {
    const audio = this.deps.audio;
    const item = audio.currentItem;
    const totalTracks = item?.song?.tracks?.length ?? 0;
    if (this.multiRemovedTracks.size >= totalTracks) {
      this.clearMultiRevealTimer();
      this.multiRevealTimer = window.setTimeout(() => {
        this.multiLastRemoved = null;
        this.revealWinner = null;
        this.broadcastMulti();
        this.broadcastReveal();
        audio.preloader.stopMulti();
        this.callNextBackend();
      }, 1500);
    } else {
      this.clearMultiRevealTimer();
      this.multiRevealTimer = window.setTimeout(() => {
        this.multiLastRemoved = null;
        this.revealWinner = null;
        this.broadcastMulti();
        this.broadcastReveal();
        this.setPhase("song");
      }, 1500);
      this.setPhase("song");
    }
  }

  private handleMultiScore(playerName: string, trackIndex: number): void {
    // Caller POSTs /api/score; monitor-web only mutes the track and updates state.
    this.deps.audio.preloader.muteMultiTrack(trackIndex);
    this.multiRemovedTracks = new Set([...this.multiRemovedTracks, trackIndex]);
    this.multiLastRemoved = { trackIndex, playerName };
    this.revealWinner = playerName;
    this.broadcastMulti();
    this.broadcastReveal();
    this.answeringPlayer = null;
    this.finishMultiStep();
  }

  private handleMultiNoWinner(trackIndex: number): void {
    this.deps.audio.preloader.muteMultiTrack(trackIndex);
    this.multiRemovedTracks = new Set([...this.multiRemovedTracks, trackIndex]);
    this.multiLastRemoved = { trackIndex, playerName: null };
    this.revealWinner = "__no_winner__";
    this.broadcastMulti();
    this.broadcastReveal();
    this.answeringPlayer = null;
    this.finishMultiStep();
  }

  private handleSetPoliteness(enabled: boolean): void {
    this.politenessEnabled = enabled;
    if (!enabled) this.pendingPoliteness = null;
  }

  private handleNextItem(item: { type?: string } | null): void {
    // Reset reveal/multi state on each new item; apply pending politeness lock.
    this.clearMultiRevealTimer();
    this.revealWinner = null;
    this.multiRemovedTracks = new Set();
    this.multiLastRemoved = null;
    this.broadcastReveal();
    this.broadcastMulti();

    if (item?.type !== "song") {
      this.activePoliteness = null;
      return;
    }
    this.activePoliteness = null;
    if (this.pendingPoliteness) {
      const pp = this.pendingPoliteness;
      this.pendingPoliteness = null;
      // The player list may not include the new device yet when the `next`
      // event lands (player_added races it) — defer one tick like the Vue
      // version's nextTick did.
      queueMicrotask(() => {
        const deviceId = this.findDeviceId(pp.playerName);
        if (deviceId) {
          this.activePoliteness = {
            playerName: pp.playerName,
            streakCount: pp.streakCount,
          };
          this.deps.sendWS({
            type: "lock_device",
            payload: {
              deviceId,
              durationMs: pp.durationMs,
              reason: "politeness",
            },
          });
        }
      });
    }
  }

  private handlePlayerBuzz(payload: {
    playerName: string;
    deviceId?: string;
  }): void {
    if (this.phase !== "song") return;
    const deviceId =
      payload.deviceId ?? this.findDeviceId(payload.playerName) ?? "";
    this.answeringPlayer = { name: payload.playerName, deviceId };
  }

  private onMessage(msg: WSMessage): void {
    if (msg.type === "next") {
      this.handleNextItem(msg.payload as { type?: string });
    } else if (msg.type === "phase_change") {
      const p = (msg.payload as { phase?: string }).phase;
      if (p) this.phase = p;
    } else if (msg.type === "player_buzz") {
      this.handlePlayerBuzz(
        msg.payload as unknown as { playerName: string; deviceId?: string },
      );
    } else if (msg.type === "remote_action") {
      const payload = msg.payload as {
        action?: string;
        playerName?: string;
        trackIndex?: string;
        enabled?: string;
      };
      switch (payload.action) {
        case "score_and_reveal":
          if (payload.playerName) this.handleScoreAndReveal(payload.playerName);
          break;
        case "no_winner":
          this.handleNoWinner();
          break;
        case "bad_response":
          this.handleBadResponse();
          break;
        case "multi_score":
          if (payload.playerName && payload.trackIndex !== undefined)
            this.handleMultiScore(
              payload.playerName,
              parseInt(payload.trackIndex),
            );
          break;
        case "multi_no_winner":
          if (payload.trackIndex !== undefined)
            this.handleMultiNoWinner(parseInt(payload.trackIndex));
          break;
        case "set_politeness":
          this.handleSetPoliteness(payload.enabled === "1");
          break;
      }
    }
  }

  dispose(): void {
    this.wsUnsub();
    this.clearMultiRevealTimer();
  }
}
