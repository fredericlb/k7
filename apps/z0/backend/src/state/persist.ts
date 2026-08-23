import { gameState } from "../gameState.ts";
import type { GristFields } from "../grist/client.ts";
import { asBool, asFloat, asInt, asString } from "../grist/values.ts";

// Write-behind: memory is the truth, and a deduplicated dirty key flushes to Grist on a debounce.

const STATE_SET_CAPACITY = 256;
// Long enough to coalesce a song advance's burst, short enough that the Grist UI feels live.
const DEFAULT_FLUSH_DEBOUNCE_MS = 200;

export interface PersistedPlayer {
  name: string;
  deviceId: string;
  score: number;
}

/** Snapshot of one game — the shape passed between persistence and resume. */
export interface PersistedState {
  gameId: string;
  createdAt: Date | null;
  players: PersistedPlayer[];
  phase: string;
  orderIndex: number;
  songIndex: number;
  started: boolean;
  finished: boolean;
  gristSessionId: number;
}

export interface BuzzerState {
  tokens: Map<string, string>;
  phoneCounter: number;
}

// ─── Worker ─────────────────────────────────────────────────────────────────

let pending = new Set<string>();
let timer: NodeJS.Timeout | null = null;
let started = false;
let debounceMs = DEFAULT_FLUSH_DEBOUNCE_MS;
let flushing: Promise<void> = Promise.resolve();

// Row-id caches so a flush never listRecords; filled on first lookup, kept until restart.
const gameRowIdById = new Map<string, number>();
const playerRowIdByKey = new Map<string, number>(); // gameId|deviceId
const buzzerRowIdByTok = new Map<string, number>();
const counterRowIdByKey = new Map<string, number>();

/** Boot the write-behind worker. Idempotent. */
export function startStateWorker(opts?: { debounceMs?: number }): void {
  if (started) return;
  started = true;
  debounceMs = opts?.debounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
  console.log(
    `[State] write-behind worker started (cap=${STATE_SET_CAPACITY}, debounce=${debounceMs}ms)`,
  );
}

/** Flush pending writes and stop. Called from shutdown so Ctrl+C persists. */
export async function stopStateWorker(): Promise<void> {
  if (!started) return;
  started = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await flushPending();
  await flushing;
}

function enqueueDirty(key: string): void {
  if (!started || !gameState.gristClient) return;
  if (pending.size >= STATE_SET_CAPACITY && !pending.has(key)) {
    console.log(`[State] dropping dirty key "${key}" — set full`);
    return;
  }
  pending.add(key);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushPending();
  }, debounceMs);
  timer.unref?.();
}

async function flushPending(): Promise<void> {
  const keys = pending;
  pending = new Set();
  // Serialize flushes so two debounce firings can't interleave row upserts.
  flushing = flushing.then(async () => {
    for (const key of keys) {
      try {
        await flushKey(key);
      } catch (err) {
        console.log(`[State] flush "${key}": ${err}`);
      }
    }
  });
  await flushing;
}

/** Test hook: wait until everything enqueued so far has been flushed. */
export async function flushNowForTest(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await flushPending();
}

/** Mark the given game as needing a Grist flush. Fire-and-forget. */
export function enqueueGameDirty(gameId: string): void {
  if (gameId !== "") enqueueDirty(`game:${gameId}`);
}

/** Mark the buzzer token map + phoneCounter as dirty. */
export function enqueueBuzzersDirty(): void {
  enqueueDirty("buzzers");
}

/** Mark the active game dirty (state.go savePersistedState). */
export function savePersistedState(): void {
  enqueueGameDirty(gameState.currentGame?.id ?? "");
}

export function saveBuzzerState(): void {
  enqueueBuzzersDirty();
}

async function flushKey(key: string): Promise<void> {
  if (key === "buzzers") return flushBuzzers();
  if (key.startsWith("game:")) return flushGame(key.slice(5));
  throw new Error(`unknown dirty key "${key}"`);
}

// ─── Game flush ─────────────────────────────────────────────────────────────

// A player removed from memory is NOT deleted in Grist: that would race hydrate-on-boot.
async function flushGame(gameId: string): Promise<void> {
  const g = gameState.gristClient;
  const db = gameState.db;
  if (!g || !db) return;
  let game;
  try {
    game = db.getGame(gameId);
  } catch {
    return; // evicted from memory; nothing to flush
  }

  // Only the active game gets live phase and progress; an old one keeps its last flush.
  let phase = "";
  let orderIdx = 0;
  let songIdx = 0;
  let startedFlag = false;
  let finished = false;
  let sessionRef = 0;
  if (gameState.currentGame?.id === gameId) {
    phase = gameState.currentPhase;
    if (gameState.sessionProgress) {
      const s = gameState.sessionProgress.snapshot();
      ({
        orderIndex: orderIdx,
        songIndex: songIdx,
        started: startedFlag,
        finished,
      } = s);
    }
    sessionRef = gameState.activeSessionId;
  }

  // Resolve/cache the Games row id first — new GamePlayers rows need the ref.
  let gameRowId = gameRowIdById.get(gameId) ?? 0;
  if (gameRowId === 0) {
    const recs = await g.listRecords("Games", { gameId });
    if (recs.length > 0) {
      gameRowId = recs[0].id;
      gameRowIdById.set(gameId, gameRowId);
    }
  }

  // Upsert each player.
  const playerIds: number[] = [];
  for (const p of game.players) {
    const pkey = `${gameId}|${p.deviceId}`;
    let pid = playerRowIdByKey.get(pkey) ?? 0;
    if (pid === 0 && gameRowId !== 0) {
      const recs = await g.listRecords("GamePlayers", { deviceId: p.deviceId });
      for (const r of recs) {
        if (asInt(r.fields.game) === gameRowId) {
          pid = r.id;
          break;
        }
      }
    }
    const fields: GristFields = {
      name: p.name,
      deviceId: p.deviceId,
      score: p.score,
    };
    if (gameRowId !== 0) fields.game = gameRowId;
    if (pid === 0) {
      [pid] = await g.addRecords("GamePlayers", [fields]);
    } else {
      await g.updateRecords("GamePlayers", new Map([[pid, fields]]));
    }
    playerRowIdByKey.set(pkey, pid);
    playerIds.push(pid);
  }

  // Upsert the Games row. (No Games.players RefList — see grist/schema.ts.)
  const gameFields: GristFields = {
    gameId,
    updatedAt: Math.floor(Date.now() / 1000),
    phase,
    orderIndex: orderIdx,
    songIndex: songIdx,
    started: startedFlag,
    finished,
  };
  gameFields.createdAt = Math.floor(game.createdAt.getTime() / 1000);
  if (sessionRef > 0) gameFields.session = sessionRef;

  if (gameRowId === 0) {
    [gameRowId] = await g.addRecords("Games", [gameFields]);
    gameRowIdById.set(gameId, gameRowId);
    // Backfill GamePlayers.game: those rows went in before this one existed, so they carry 0.
    if (playerIds.length > 0) {
      const updates = new Map<number, GristFields>();
      for (const pid of playerIds) updates.set(pid, { game: gameRowId });
      await g.updateRecords("GamePlayers", updates);
    }
  } else {
    await g.updateRecords("Games", new Map([[gameRowId, gameFields]]));
  }
}

// ─── Buzzer flush ───────────────────────────────────────────────────────────

async function flushBuzzers(): Promise<void> {
  const g = gameState.gristClient;
  if (!g) return;
  const tokens = new Map(gameState.buzzerTokens);
  const counter = gameState.phoneCounter;

  for (const [token, deviceId] of tokens) {
    let rid = buzzerRowIdByTok.get(token) ?? 0;
    if (rid === 0) {
      const recs = await g.listRecords("Buzzers", { token });
      if (recs.length > 0) rid = recs[0].id;
    }
    const fields: GristFields = { token, deviceId };
    if (rid === 0) {
      fields.createdAt = Math.floor(Date.now() / 1000);
      [rid] = await g.addRecords("Buzzers", [fields]);
    } else {
      await g.updateRecords("Buzzers", new Map([[rid, fields]]));
    }
    buzzerRowIdByTok.set(token, rid);
  }

  await upsertCounter("phoneCounter", counter);
}

async function upsertCounter(name: string, value: number): Promise<void> {
  const g = gameState.gristClient;
  if (!g) return;
  let rid = counterRowIdByKey.get(name) ?? 0;
  if (rid === 0) {
    const recs = await g.listRecords("Counters", { name });
    if (recs.length > 0) rid = recs[0].id;
  }
  const fields: GristFields = { name, value };
  if (rid === 0) {
    [rid] = await g.addRecords("Counters", [fields]);
  } else {
    await g.updateRecords("Counters", new Map([[rid, fields]]));
  }
  counterRowIdByKey.set(name, rid);
}

// ─── Resume / hydrate from Grist ────────────────────────────────────────────

/** Snapshot for gameId, or null. Warms the row-id cache. */
export async function loadGameFromGrist(
  gameId: string,
): Promise<PersistedState | null> {
  const g = gameState.gristClient;
  if (!g) return null;
  const recs = await g.listRecords("Games", { gameId });
  if (recs.length === 0) return null;
  gameRowIdById.set(gameId, recs[0].id);
  return persistedStateFromGames(recs[0].id, recs[0].fields);
}

/** Snapshot for gameID with transport errors logged, not thrown (state.go). */
export async function loadPersistedState(
  gameId: string,
): Promise<PersistedState | null> {
  if (gameId === "") return null;
  try {
    return await loadGameFromGrist(gameId);
  } catch (err) {
    console.log(`[State] load ${gameId}: ${err}`);
    return null;
  }
}

/** Every persisted game — used at boot to hydrate the in-memory Database. */
export async function loadAllPersistedStates(): Promise<PersistedState[]> {
  const g = gameState.gristClient;
  if (!g) return [];
  let recs;
  try {
    recs = await g.listRecords("Games");
  } catch (err) {
    console.log(`[State] list games: ${err}`);
    return [];
  }
  const out: PersistedState[] = [];
  for (const r of recs) {
    try {
      const ps = await persistedStateFromGames(r.id, r.fields);
      if (ps.gameId === "") continue;
      gameRowIdById.set(ps.gameId, r.id);
      out.push(ps);
    } catch (err) {
      console.log(`[State] skip Games row id=${r.id}: ${err}`);
    }
  }
  return out;
}

async function persistedStateFromGames(
  rowId: number,
  fields: Record<string, unknown>,
): Promise<PersistedState> {
  const gameId = asString(fields.gameId);
  const createdAtSec = asInt(fields.createdAt);
  return {
    gameId,
    createdAt: createdAtSec > 0 ? new Date(createdAtSec * 1000) : null,
    phase: asString(fields.phase),
    orderIndex: asInt(fields.orderIndex),
    songIndex: asInt(fields.songIndex),
    started: asBool(fields.started),
    finished: asBool(fields.finished),
    gristSessionId: asInt(fields.session),
    players: await loadPlayersForGameRowId(rowId, gameId),
  };
}

async function loadPlayersForGameRowId(
  gameRowId: number,
  gameId: string,
): Promise<PersistedPlayer[]> {
  const g = gameState.gristClient;
  if (!g || gameRowId === 0) return [];
  const recs = await g.listRecords("GamePlayers", { game: gameRowId });
  const out: PersistedPlayer[] = [];
  for (const r of recs) {
    const deviceId = asString(r.fields.deviceId);
    out.push({
      name: asString(r.fields.name),
      deviceId,
      score: asFloat(r.fields.score),
    });
    if (deviceId !== "" && gameId !== "")
      playerRowIdByKey.set(`${gameId}|${deviceId}`, r.id);
  }
  return out;
}

/** Rebuild buzzerTokens + phoneCounter from Grist (Buzzers + Counters). */
export async function loadBuzzersFromGrist(): Promise<BuzzerState | null> {
  const g = gameState.gristClient;
  if (!g) return null;
  const recs = await g.listRecords("Buzzers");
  const tokens = new Map<string, string>();
  for (const r of recs) {
    const token = asString(r.fields.token);
    const dev = asString(r.fields.deviceId);
    if (token === "" || dev === "") continue;
    tokens.set(token, dev);
    buzzerRowIdByTok.set(token, r.id);
  }
  let counter = 0;
  const cRecs = await g.listRecords("Counters", { name: "phoneCounter" });
  if (cRecs.length > 0) {
    counter = asInt(cRecs[0].fields.value);
    counterRowIdByKey.set("phoneCounter", cRecs[0].id);
  }
  return { tokens, phoneCounter: counter };
}

/** Numeric part of a "P<n>" device id (state.go parsePhoneID). */
export function parsePhoneId(id: string): number | null {
  if (!id.startsWith("P")) return null;
  const n = Number(id.slice(1));
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/** Restore the tokens, bumping the counter past every P<n> seen so a fresh id never collides. */
export async function loadBuzzerState(): Promise<void> {
  let bs: BuzzerState | null;
  try {
    bs = await loadBuzzersFromGrist();
  } catch (err) {
    console.log(`[State] load buzzers: ${err}`);
    return;
  }
  if (!bs) return;
  if (bs.tokens.size > 0) gameState.buzzerTokens = bs.tokens;

  let maxN = bs.phoneCounter;
  for (const did of bs.tokens.values()) {
    const n = parsePhoneId(did);
    if (n !== null && n > maxN) maxN = n;
  }
  for (const p of gameState.currentGame?.players ?? []) {
    const n = parsePhoneId(p.deviceId);
    if (n !== null && n > maxN) maxN = n;
  }
  gameState.phoneCounter = maxN;
  console.log(
    `[State] Restored ${bs.tokens.size} buzzer tokens, phoneCounter=${maxN}`,
  );
}
