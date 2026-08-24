// Shared mutable game-state globals. Node is single-threaded, so none of this
// needs a lock; the write-behind persistence in state/persist.ts keeps Grist in
// sync asynchronously.
import type { Database, Game } from "./db.ts";
import type { GristClient } from "./grist/client.ts";
import type { SessionProgress } from "./session/progress.ts";
import type { WsHub } from "./ws.ts";

export const gameState: {
  // Open at boot: the server starts in the registration phase, so a buzzer can join at once.
  registrationStarted: boolean;
  registrationComplete: boolean;
  sessionProgress: SessionProgress | null;
  /** Currently selected Grist session row id; 0 = none. */
  activeSessionId: number;
  currentGame: Game | null;
  gameSelected: boolean;
  currentPhase: string;
  db: Database | null;
  gristClient: GristClient | null;
  hub: WsHub | null;
  /** Buzzer session persistence: token → deviceId. */
  buzzerTokens: Map<string, string>;
  /** Monotonic counter behind "P<n>" device ids. */
  phoneCounter: number;
  /** Buzzer lock state (answer phase). */
  buzzersLocked: boolean;
  /** Per-device cooldowns: deviceId → epoch-ms until which buzzes reject. */
  deviceCooldowns: Map<string, number>;
  deviceCooldownReasons: Map<string, string>;
  /** Server timestamp origin (epoch ms) — clients sync clocks against it. */
  serverTimeOrigin: number;
  /** When buzzers were last unlocked (server-relative ms). */
  questionStartedAt: number;
} = {
  registrationStarted: true,
  registrationComplete: false,
  sessionProgress: null,
  activeSessionId: 0,
  currentGame: null,
  gameSelected: false,
  currentPhase: "",
  db: null,
  gristClient: null,
  hub: null,
  buzzerTokens: new Map(),
  phoneCounter: 0,
  buzzersLocked: false,
  deviceCooldowns: new Map(),
  deviceCooldownReasons: new Map(),
  serverTimeOrigin: Date.now(),
  questionStartedAt: 0,
};

/** Server-relative timestamp in ms (Go: time.Now().UnixMilli() - serverTimeOrigin). */
export function serverRelativeNow(): number {
  return Date.now() - gameState.serverTimeOrigin;
}
