import { f } from "../lib/api";
import type { GamePhase, NextItem } from "../types/game";

// Framework-free port of composables/useGameLogic.ts. The Vue refs became
// plain mutable fields: the canvas draw loop reads them directly every frame,
// so no reactivity is needed — except gamePhase, whose changes drive the React
// overlays (loading / waiting-for-remote) and the answer-timer ticks, so it
// notifies subscribers.
//
// The audio side is intentionally thin: playback is owned by monitor-web, and
// the few remaining calls (pause/stop on buzz, resume_context, master gain)
// are forwarded as audio_command WS messages by the component wiring. The old
// local fusion-alternation machinery was already dead (never called, wired to
// no-ops) and is not ported.

export interface GameLogicDeps {
  stop: () => void;
  pause: () => void;
  setGain: (value: number) => void;
  resumeContext: () => void;
  preloadCategory: (songs: unknown[]) => Promise<void>;
  wsSend: (msg: { type: string; payload: any }) => void;
  ensureCharState: (name: string, W: number) => void;
  getCanvasWidth: () => number;
  playBip: () => void;
}

const SKIP_HOLD_DURATION = 5;

export class GameLogic {
  // Renderer-read state (mutated here, read by the draw loop each frame).
  currentItem: NextItem | null = null;
  players: Record<string, string> = {};
  playerScores: Record<string, number> = {};
  answeringPlayer: { name: string; deviceId: string } | null = null;
  revealWinner: string | null = null;
  showResumeOption = false;
  buzzingPlayers = new Set<string>();
  masterGain = 0.8;
  categoryNotice: string | null = null;
  totalSongs = 0;
  // Reveal/multi/politeness state machine lives in monitor-web. These are
  // renderer-only — populated by `reveal_state`/`multi_state` broadcasts.
  multiRemovedTracks = new Set<number>();
  multiLastRemoved: { trackIndex: number; playerName: string | null } | null =
    null;

  gamePhase: GamePhase = "loading";
  private phaseListeners = new Set<(phase: GamePhase) => void>();

  private categoryCount = 0;
  private questionNumber = 0;
  private judgingInput = "";
  private skipHoldStart = -1;
  private cachedGameInfo: any = null;
  private currentMode = "";
  private pendingCategoryPreload: NextItem | null = null;
  private pendingAfterMystery: (() => void) | null = null;
  private callNextInFlight = false;
  private pendingResumeItem: {
    item: NextItem;
    info: any;
    targetPhase?: string;
  } | null = null;

  private deps: GameLogicDeps;

  constructor(deps: GameLogicDeps) {
    this.deps = deps;
  }

  onPhaseChange(cb: (phase: GamePhase) => void): () => void {
    this.phaseListeners.add(cb);
    return () => this.phaseListeners.delete(cb);
  }

  setPhase(p: GamePhase): void {
    this.gamePhase = p;
    for (const l of this.phaseListeners) l(p);
  }

  private schedulePreloadAfterPaint(songs: unknown[]): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void this.deps.preloadCategory(songs);
      });
    });
  }

  private enterCategoryOrScoreboard(item: NextItem): void {
    this.categoryNotice = item.category?.notice ?? null;
    this.categoryCount++;
    if (this.categoryCount > 1) {
      this.pendingCategoryPreload = item;
      this.setPhase("scoreboard");
    } else if (item.category?.mode === "pause") {
      this.setPhase("pause");
    } else {
      this.setPhase("category");
      if (item.category?.songs)
        this.schedulePreloadAfterPaint(item.category.songs);
    }
  }

  /**
   * Process a `next` item received over WS (broadcast by the backend after
   * any client POSTs /api/next). The presenter is purely a renderer here:
   * monitor-web owns audio playback and reacts to the same `next` event
   * independently.
   */
  applyNextItem(item: NextItem): void {
    const prevMode = this.currentMode;
    this.currentItem = item;
    this.currentMode = item.mode ?? "";
    if (item.finished) {
      if (prevMode === "mystery") {
        this.pendingAfterMystery = () => this.setPhase("end");
        this.setPhase("mystery-question");
      } else {
        this.setPhase("end");
      }
    } else if (item.type === "category") {
      if (prevMode === "mystery") {
        this.pendingAfterMystery = () => this.enterCategoryOrScoreboard(item);
        this.setPhase("mystery-question");
      } else {
        this.enterCategoryOrScoreboard(item);
      }
    } else if (item.type === "song") {
      this.questionNumber++;
      this.setPhase("song");
    }
  }

  /**
   * Trigger the backend to advance. The resulting "next" broadcast is what
   * updates state via applyNextItem — this just kicks off the request.
   */
  private async doCallNext(): Promise<void> {
    if (this.callNextInFlight) return;
    this.callNextInFlight = true;
    try {
      await f("/api/next", { method: "POST" });
    } catch (e) {
      console.error("Failed /next:", e);
    } finally {
      this.callNextInFlight = false;
    }
  }

  private async doCallNextCategory(): Promise<void> {
    try {
      const res = await f("/api/next-category", { method: "POST" });
      const item: NextItem = await res.json();
      this.currentItem = item;
      this.currentMode = item.mode ?? "";
      if (item.finished) this.setPhase("end");
      else if (item.type === "category") {
        this.enterCategoryOrScoreboard(item);
      }
    } catch (e) {
      console.error("Failed /next-category:", e);
    }
  }

  callNextCategory = (): void => {
    this.deps.resumeContext();
    void this.doCallNextCategory();
  };

  async checkResumable(): Promise<any> {
    try {
      const res = await f("/api/game");
      this.cachedGameInfo = await res.json();
      if (typeof this.cachedGameInfo.totalSongs === "number") {
        this.totalSongs = this.cachedGameInfo.totalSongs;
      }
      if (
        this.cachedGameInfo.sessionStarted &&
        this.cachedGameInfo.players?.length > 0
      ) {
        this.showResumeOption = true;
      }
      return this.cachedGameInfo;
    } catch {
      return null;
    }
  }

  private loadPlayers(info: any): void {
    if (info.players?.length > 0) {
      const map: Record<string, string> = {};
      for (const p of info.players) map[p.name] = p.deviceId;
      this.players = map;
      for (const p of info.players) {
        if (p.score > 0) this.playerScores[p.name] = p.score;
      }
    }
  }

  async resumeGame(targetPhase?: string): Promise<void> {
    const info = this.cachedGameInfo;
    if (!info?.sessionStarted) return;

    this.loadPlayers(info);
    this.showResumeOption = false;

    const item: NextItem | undefined = info.currentItem;
    if (item) {
      this.currentItem = item;
      this.currentMode = item.mode ?? "";
      this.pendingResumeItem = { item, info, targetPhase };
    }

    this.deps.resumeContext();
    this.resumeFromPlayers();
  }

  resumeFromPlayers(): void {
    if (!this.pendingResumeItem) return;
    const { item, targetPhase } = this.pendingResumeItem;
    this.pendingResumeItem = null;
    this.deps.resumeContext();

    if (item.finished) {
      this.setPhase("end");
      return;
    }

    if (item.type === "category") {
      this.categoryCount++;
      this.categoryNotice = item.category?.notice ?? null;
      // Honor backend phase for category-type items (scoreboard, pause, mystery-question).
      if (targetPhase === "mystery-question") {
        // Confirm should advance into the next category on resume.
        this.pendingAfterMystery = () => this.enterCategoryOrScoreboard(item);
        this.setPhase("mystery-question");
      } else if (targetPhase === "scoreboard") {
        // showCategory() reads pendingCategoryPreload to decide the next phase.
        this.pendingCategoryPreload = item;
        this.setPhase("scoreboard");
      } else if (targetPhase === "pause") {
        this.setPhase("pause");
      } else if (item.category?.mode === "pause") {
        this.setPhase("pause");
      } else {
        this.setPhase("category");
      }
      if (item.category?.songs)
        this.schedulePreloadAfterPaint(item.category.songs);
      return;
    }

    if (item.type === "song") {
      this.questionNumber++;
      // Audio is owned by monitor-web; the presenter just restores phase.
      if (
        targetPhase === "answering" ||
        targetPhase === "judging" ||
        targetPhase === "reveal"
      ) {
        this.setPhase(targetPhase as GamePhase);
      } else {
        this.setPhase("song");
      }
    }
  }

  async startGame(): Promise<void> {
    try {
      const info = this.cachedGameInfo ?? (await (await f("/api/game")).json());
      // If session is already in progress, delegate to resumeGame
      if (info.sessionStarted && info.currentItem && info.players?.length > 0) {
        this.cachedGameInfo = info;
        this.showResumeOption = true;
        void this.resumeGame();
        return;
      }
      if (info.players?.length > 0) this.loadPlayers(info);
      await this.openRegistration();
      this.showResumeOption = false;
      this.setPhase("registration");
    } catch {
      await this.openRegistration();
      this.showResumeOption = false;
      this.setPhase("registration");
    }
  }

  private async openRegistration(): Promise<void> {
    try {
      await f("/api/registration", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: false }),
      });
    } catch (e) {
      console.error("Failed to open registration:", e);
    }
  }

  private enterGameTransition(): void {
    this.deps.resumeContext();
    void this.doCallNext();
  }

  private async onLetsStart(): Promise<void> {
    if (this.pendingResumeItem) {
      this.resumeFromPlayers();
      return;
    }
    try {
      await f("/api/players/done", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const info = await (await f("/api/game")).json();
      if (info.players?.length > 0) this.loadPlayers(info);
    } catch (e) {
      console.error("Failed to finalize registration:", e);
    }
    this.enterGameTransition();
  }

  callNext = (): void => {
    this.deps.resumeContext();
    void this.doCallNext();
  };

  handlePlayerBuzz = (payload: {
    playerName: string;
    deviceId: string;
  }): void => {
    if (this.gamePhase === "registration") {
      this.buzzingPlayers = new Set([
        ...this.buzzingPlayers,
        payload.playerName,
      ]);
      setTimeout(() => {
        const next = new Set(this.buzzingPlayers);
        next.delete(payload.playerName);
        this.buzzingPlayers = next;
      }, 1000);
      return;
    }
    if (this.gamePhase !== "song") return;
    this.deps.playBip();
    this.answeringPlayer = {
      name: payload.playerName,
      deviceId: payload.deviceId,
    };
    if (this.currentMode === "multi") {
      // Audio keeps playing in multi mode
    } else if (this.currentMode === "free") {
      // No audio to pause
    } else if (this.currentMode === "fusion") {
      this.deps.stop();
    } else {
      this.deps.pause();
    }
    // Phase ownership lives on the backend — flushBuzzes emits
    // phase_change("answering") right after broadcasting player_buzz, and
    // the phase_change WS listener applies it; setting gamePhase ourselves
    // would just race with the broadcast.
  };

  /**
   * Reveal/multi/badResponse handlers all live in monitor-web now. The
   * presenter only renders state from `reveal_state`/`multi_state` broadcasts.
   * Dismiss-reveal is just "advance the backend"; monitor-web clears the
   * reveal state on the resulting `next` broadcast.
   */
  private dismissReveal(): void {
    this.answeringPlayer = null;
    this.callNext();
  }

  private showCategory(): void {
    if (this.pendingCategoryPreload?.category?.mode === "pause") {
      this.setPhase("pause");
      this.pendingCategoryPreload = null;
      return;
    }
    this.setPhase("category");
    if (this.pendingCategoryPreload?.category?.songs) {
      this.schedulePreloadAfterPaint(
        this.pendingCategoryPreload.category.songs,
      );
    }
    this.pendingCategoryPreload = null;
  }

  actionConfirm = (): void => {
    if (this.gamePhase === "registration") {
      void this.onLetsStart();
      return;
    }
    if (this.gamePhase === "scoreboard") {
      this.showCategory();
      return;
    }
    if (this.gamePhase === "pause") {
      this.callNext();
      return;
    }
    if (this.gamePhase === "category") {
      this.callNext();
      return;
    }
    if (this.gamePhase === "mystery-question") {
      if (this.pendingAfterMystery) {
        const cb = this.pendingAfterMystery;
        this.pendingAfterMystery = null;
        cb();
      }
      return;
    }
    if (this.gamePhase === "reveal") {
      this.dismissReveal();
      return;
    }
  };

  actionJudge = (): void => {
    if (this.gamePhase === "answering") {
      this.judgingInput = "";
      this.setPhase("judging");
    } else if (this.gamePhase === "judging") {
      let winnerName: string | null = null;
      if (this.judgingInput !== "") {
        const idx = parseInt(this.judgingInput) - 1;
        winnerName = Object.keys(this.players)[idx] ?? null;
      } else {
        winnerName = this.answeringPlayer?.name ?? null;
      }
      if (winnerName) {
        // Score + reveal flow lives in monitor-web. POST then dispatch.
        const playerName = winnerName;
        f("/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerName }),
        }).catch((e) => console.error("Score failed:", e));
        this.deps.wsSend({
          type: "remote_action",
          payload: { action: "score_and_reveal", playerName },
        });
      }
    }
  };

  handlePlayerAdded = (payload: {
    playerName: string;
    deviceId: string;
  }): void => {
    this.players = { ...this.players, [payload.playerName]: payload.deviceId };
    this.deps.ensureCharState(payload.playerName, this.deps.getCanvasWidth());
  };

  handleBump = (payload: { player: string }): void => {
    this.playerScores[payload.player] =
      (this.playerScores[payload.player] ?? 0) + 1;
  };

  handleScoreSet = (payload: { player: string; score: number }): void => {
    this.playerScores[payload.player] = payload.score;
  };

  setMasterGain(value: number): void {
    this.masterGain = value;
    this.deps.setGain(value);
  }

  // Accessors for the draw loop.
  getJudgingInput = (): string => this.judgingInput;
  setJudgingInput = (v: string): void => {
    this.judgingInput = v;
  };
  getSkipHoldStart = (): number => this.skipHoldStart;
  setSkipHoldStart = (v: number): void => {
    this.skipHoldStart = v;
  };
  getQuestionNumber = (): number => this.questionNumber;
  getSkipHoldDuration = (): number => SKIP_HOLD_DURATION;
  getCurrentMode = (): string => this.currentMode;
}
