import { gameState, serverRelativeNow } from "../gameState.ts";
import { savePersistedState } from "../state/persist.ts";

// The authoritative phase machine (main.go). The backend owns the phase: it
// derives the buzzer lock state from the new phase, persists the change, and
// fans phase_change out to every client. All callers — flushBuzzes,
// remote_action dispatch, handleNext, registration toggle — go through
// setServerPhase so the phase/lock invariants hold no matter how many
// remotes or buzzers are racing.

/**
 * The two phases where buzzers are unlocked. Anything else (answering,
 * reveal, category, end, …) means locked. Single source of truth used by
 * setServerPhase to derive lock state.
 */
export function phaseAcceptsBuzzes(phase: string): boolean {
  return phase === "song" || phase === "registration";
}

interface PendingBuzz {
  playerName: string;
  deviceId: string;
  /** server-relative ms */
  timestamp: number;
}

// Buzz collection window: collect buzzes for 150ms then pick the earliest.
const BUZZ_COLLECT_WINDOW_MS = 150;
let pendingBuzzes: PendingBuzz[] = [];
let buzzCollectTimer: NodeJS.Timeout | null = null;

/**
 * Flip the lock flag, drop any in-flight buzz collection window, notify every
 * buzzer client. Server-internal: callers go through setServerPhase.
 */
function lockBuzzersInternal(): void {
  gameState.buzzersLocked = true;
  const cleared = pendingBuzzes.length;
  if (buzzCollectTimer) {
    clearTimeout(buzzCollectTimer);
    buzzCollectTimer = null;
  }
  pendingBuzzes = [];
  if (cleared > 0)
    console.log(`[PhaseTrace] lockBuzzers cleared ${cleared} pending buzzes`);
  gameState.hub?.broadcastBuzzers({
    type: "buzzer_locked",
    payload: { locked: true },
  });
}

/**
 * Flip the lock flag, record the question-start timestamp (validates buzz
 * timestamps), notify every buzzer client. Per-device cooldowns from prior
 * wrong-answer punishments are preserved by re-emitting a device-specific
 * locked=true with the remaining duration.
 */
function unlockBuzzersInternal(): void {
  gameState.buzzersLocked = false;
  gameState.questionStartedAt = serverRelativeNow();

  const now = Date.now();
  const perDevice = new Map<string, number>();
  for (const [did, until] of gameState.deviceCooldowns) {
    const remaining = until - now;
    if (remaining > 0) perDevice.set(did, remaining);
  }
  gameState.hub?.broadcastBuzzersExcept(perDevice, {
    type: "buzzer_locked",
    payload: { locked: false },
  });
  for (const [did, ms] of perDevice) {
    const payload: Record<string, unknown> = { locked: true, durationMs: ms };
    const reason = gameState.deviceCooldownReasons.get(did);
    if (reason) payload.reason = reason;
    gameState.hub?.notifyBuzzerDevice(did, { type: "buzzer_locked", payload });
  }
}

/** The single phase-transition entry point (main.go setServerPhase). */
export function setServerPhase(newPhase: string): void {
  const prev = gameState.currentPhase;
  if (prev === newPhase) return;
  gameState.currentPhase = newPhase;

  const prevAccepts = phaseAcceptsBuzzes(prev);
  const nowAccepts = phaseAcceptsBuzzes(newPhase);
  if (prevAccepts !== nowAccepts) {
    if (nowAccepts) unlockBuzzersInternal();
    else lockBuzzersInternal();
  }

  console.log(
    `[PhaseTrace] setServerPhase ${prev}→${newPhase} (buzzersLocked=${!nowAccepts})`,
  );
  savePersistedState();

  const payload = { phase: newPhase };
  gameState.hub?.broadcastMain({ type: "phase_change", payload });
  gameState.hub?.broadcastBuzzers({ type: "phase_change", payload });
}

/**
 * Add a buzz to the collection window. The first buzz starts a 150ms timer;
 * when it fires the earliest-timestamped buzz wins.
 */
export function enqueueBuzz(
  playerName: string,
  deviceId: string,
  timestamp: number,
): void {
  pendingBuzzes.push({ playerName, deviceId, timestamp });
  console.log(
    `[PhaseTrace] enqueueBuzz player=${playerName} device=${deviceId} ts=${timestamp} (now ${pendingBuzzes.length} in window)`,
  );
  if (!buzzCollectTimer) {
    buzzCollectTimer = setTimeout(flushBuzzes, BUZZ_COLLECT_WINDOW_MS);
  }
}

/**
 * Pick the earliest-timestamped buzz, broadcast it, and transition
 * song→answering (which auto-locks buzzers via setServerPhase).
 */
export function flushBuzzes(): void {
  const buzzes = pendingBuzzes;
  pendingBuzzes = [];
  if (buzzCollectTimer) {
    clearTimeout(buzzCollectTimer);
    buzzCollectTimer = null;
  }
  if (buzzes.length === 0) return;

  let winner = buzzes[0];
  for (const b of buzzes.slice(1)) {
    if (b.timestamp < winner.timestamp) winner = b;
  }

  const losers = buzzes
    .filter(
      (b) =>
        !(b.deviceId === winner.deviceId && b.timestamp === winner.timestamp),
    )
    .map((b) => `${b.playerName}(ts=${b.timestamp})`);
  console.log(
    `[PhaseTrace] flushBuzzes winner=${winner.playerName} ts=${winner.timestamp} candidates=${buzzes.length} losers=[${losers.join(",")}]`,
  );
  broadcastPlayerBuzz(winner.playerName, winner.deviceId);
  // Single point of truth for the song→answering transition — multiple
  // buzzers may have raced into the 150ms window.
  if (gameState.currentPhase === "song") setServerPhase("answering");
}

// ─── Broadcast helpers shared by HTTP + WS layers (main.go) ────────────────

export function broadcastPlayerBuzz(
  playerName: string,
  deviceId: string,
): void {
  const msg = { type: "player_buzz", payload: { playerName, deviceId } };
  gameState.hub?.broadcastMain(msg);
  gameState.hub?.broadcastBuzzers(msg);
}

export function broadcastDeviceBuzz(deviceId: string): void {
  gameState.hub?.broadcastMain({ type: "device_buzz", payload: { deviceId } });
}

export function broadcastPlayerAdded(
  playerName: string,
  deviceId: string,
): void {
  gameState.hub?.broadcastMain({
    type: "player_added",
    payload: { playerName, deviceId },
  });
}

export function broadcastBumpMessage(playerName: string): void {
  const msg = { type: "bump", payload: { player: playerName } };
  gameState.hub?.broadcastMain(msg);
  gameState.hub?.broadcastBuzzers(msg);
}

export function broadcastRegistrationState(): void {
  const msg = {
    type: "registration_state",
    payload: {
      locked: gameState.registrationComplete,
      started: gameState.registrationStarted,
    },
  };
  gameState.hub?.broadcastMain(msg);
  gameState.hub?.broadcastBuzzers(msg);
}
