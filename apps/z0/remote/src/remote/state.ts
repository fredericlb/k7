// The remote's state: one mutable bag read by every view, re-rendered by an explicit `render()`.
// It is mutated in place on purpose — socket handlers registered once must see the CURRENT values.

import type { LoadProgress, SessionRow } from "z0-shared/types";
import type { WakeLock } from "../lib/wakeLock";
import type { BuzzerSocket } from "../lib/ws";
import { m } from "../paraglide/messages.js";

export interface Player {
  name: string;
  deviceId: string;
  score: number;
}
export interface MultiTrack {
  title: string;
  artist?: string;
  removed: boolean;
}
export interface PeekInfo {
  type: string;
  categoryName?: string;
  songArtist?: string;
  songTitle?: string;
  mode?: string;
  finished?: boolean;
}

export type RemoteTab = "controls" | "manual" | "players" | "buzzers";

export const ANSWER_DURATION = 12;
export const PUNISH_AMOUNT = 2000;
export const POLITENESS_KEY = "remote_politeness_enabled";

// Spelled out because Paraglide only compiles calls it can see, and the phase names arrive at runtime.
export const PHASE_LABELS: Partial<Record<string, () => string>> = {
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

export function createRemoteState() {
  return {
    needsUnlock: true,
    activeTab: "controls" as RemoteTab,
    sessions: [] as SessionRow[],
    activeSessionId: 0,
    sessionsLoading: false,
    sessionsError: "",
    sessionSelecting: 0,
    sessionProgress: null as LoadProgress | null,
    sessionPickerOpen: false,
    gamePhase: "unknown",
    // biome-ignore lint/suspicious/noExplicitAny: the item payload is the server's untyped round item.
    currentItem: null as any,
    players: [] as Player[],
    connectedDevices: new Set<string>(),
    buzzingPlayers: new Set<string>(),
    latestBuzzer: null as string | null,
    categoryName: "",
    peekInfo: null as PeekInfo | null,
    answerRemaining: 0,
    gainLevel: 80,
    isMuted: false,
    micEnabled: false,
    micGainPct: 100,
    audioPlaying: false,
    audioPaused: false,
    currentMode: "",
    multiTracks: [] as MultiTrack[],
    pendingScorePlayer: null as string | null,
    showTrackPicker: false,
    preloading: false,
    preloadProgress: 0,
    preloadLoaded: 0,
    preloadTotal: 0,
    preloadFailedPaths: [] as string[],
    newPlayerName: "",
    createPlayerError: "",
    politenessEnabled: localStorage.getItem(POLITENESS_KEY) !== "0",
    registrationLocked: false,
    scoreEditorOpen: false,
    scoreEditorPlayer: null as string | null,
    scoreEditorValue: 0,
    punishConfirmOpen: false,
    punishTarget: null as string | null,
  };
}

export type RemoteState = ReturnType<typeof createRemoteState>;

// What never reaches the screen: timestamps, animation frames, the simulated players' sockets.
export function createRuntime() {
  return {
    songStartTime: 0,
    buzzElapsed: 0,
    answerStartMs: 0,
    answerAnimFrame: 0,
    buzzerSockets: new Map<string, WebSocket>(),
  };
}

export interface RemoteCtx {
  g: RemoteState;
  nr: ReturnType<typeof createRuntime>;
  render: () => void;
  socket: BuzzerSocket;
  wakeLock: WakeLock;
}
