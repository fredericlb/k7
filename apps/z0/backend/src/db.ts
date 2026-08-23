import { gameState } from "./gameState.ts";
import { loadAllPersistedStates, savePersistedState } from "./state/persist.ts";

// Memory IS the source of truth; state/persist.ts write-behinds it to Grist and rehydrates on boot.

export interface Player {
  name: string;
  deviceId: string;
  score: number;
}

export interface Game {
  id: string;
  createdAt: Date;
  players: Player[];
}

const GAME_ID_CHARSET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const GAME_ID_LENGTH = 6;

export class Database {
  private games = new Map<string, Game>();

  /** Hydrate the in-memory store from Grist (Games table). */
  static async create(): Promise<Database> {
    const d = new Database();
    const states = await loadAllPersistedStates();
    for (const ps of states) {
      d.games.set(ps.gameId, {
        id: ps.gameId,
        createdAt: ps.createdAt ?? new Date(),
        players: ps.players.map((p) => ({
          name: p.name,
          deviceId: p.deviceId,
          score: p.score,
        })),
      });
    }
    console.log(`[State] hydrated ${d.games.size} games from Grist`);
    return d;
  }

  private generateGameId(): string {
    let id = "";
    for (let i = 0; i < GAME_ID_LENGTH; i++) {
      id += GAME_ID_CHARSET[Math.floor(Math.random() * GAME_ID_CHARSET.length)];
    }
    return id;
  }

  /** Allocate a fresh in-memory game with the provided id. */
  createEmptyGameWithId(id: string): Game {
    if (this.games.has(id)) throw new Error(`game ${id} already exists`);
    const game: Game = { id, createdAt: new Date(), players: [] };
    this.games.set(id, game);
    return game;
  }

  /** Allocate a fresh in-memory game with a random 6-char id. */
  createEmptyGame(): Game {
    for (let i = 0; i < 50; i++) {
      const candidate = this.generateGameId();
      if (!this.games.has(candidate))
        return this.createEmptyGameWithId(candidate);
    }
    throw new Error("failed to generate a unique game ID");
  }

  /** Read-only snapshot of a game. */
  getGame(gameId: string): Game {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`game not found: ${gameId}`);
    return { ...game, players: game.players.map((p) => ({ ...p })) };
  }

  hasGame(gameId: string): boolean {
    return this.games.has(gameId);
  }

  /** Snapshot of every game (main.go handleListGames reads db.games). */
  listGames(): Game[] {
    return [...this.games.values()].map((g) => ({
      ...g,
      players: g.players.map((p) => ({ ...p })),
    }));
  }

  /** Upsert a whole game record (used by the Grist resume path). */
  replaceGame(game: Game): void {
    this.games.set(game.id, game);
  }

  /** The game with the most recent createdAt. */
  getLatestGame(): Game {
    let latest: Game | null = null;
    for (const g of this.games.values()) {
      if (!latest || g.createdAt > latest.createdAt) latest = g;
    }
    if (!latest) throw new Error("no games found");
    return { ...latest, players: latest.players.map((p) => ({ ...p })) };
  }

  /** Append a player (unique name, unique device) and persist. */
  addPlayer(gameId: string, name: string, deviceId: string): void {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`game not found: ${gameId}`);
    for (const p of game.players) {
      if (p.name.toLowerCase() === name.toLowerCase())
        throw new Error("name already taken");
      if (p.deviceId === deviceId)
        throw new Error(`device already assigned: ${deviceId}`);
    }
    game.players.push({ name, deviceId, score: 0 });
    savePersistedState();
  }

  updatePlayerScore(gameId: string, deviceId: string, score: number): void {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`game not found: ${gameId}`);
    const p = game.players.find((p) => p.deviceId === deviceId);
    if (!p) throw new Error("player not found in game");
    p.score = score;
    savePersistedState();
  }

  /** Clear a player's device binding. */
  unlinkPlayerDevice(gameId: string, name: string): void {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`game not found: ${gameId}`);
    const p = game.players.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    if (!p) throw new Error("player not found");
    p.deviceId = "";
    savePersistedState();
  }

  /** Fill an empty device slot, refusing if another player already holds that device. */
  rebindPlayerDevice(gameId: string, name: string, deviceId: string): void {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`game not found: ${gameId}`);
    let target: Player | null = null;
    for (const p of game.players) {
      if (p.name.toLowerCase() === name.toLowerCase()) {
        target = p;
      } else if (p.deviceId === deviceId) {
        throw new Error(`device already assigned: ${deviceId}`);
      }
    }
    if (!target) throw new Error("player not found");
    if (target.deviceId !== "" && target.deviceId !== deviceId) {
      throw new Error("player already has a device");
    }
    target.deviceId = deviceId;
    savePersistedState();
  }

  getPlayerByDeviceId(gameId: string, deviceId: string): Player {
    const game = this.games.get(gameId);
    if (!game) throw new Error(`game not found: ${gameId}`);
    const p = game.players.find((p) => p.deviceId === deviceId);
    if (!p) throw new Error("player not found");
    return { ...p };
  }
}

/** Load an existing game by id or create a new empty one (database.go). */
export function initializeGame(db: Database, continueId: string): Game {
  if (continueId !== "") {
    const game = db.getGame(continueId);
    console.log(`Continued existing game: ${game.id}`);
    console.log(`Players (${game.players.length}):`);
    for (const p of game.players) {
      console.log(`  - ${p.name} (Device: ${p.deviceId}, Score: ${p.score})`);
    }
    return game;
  }
  const game = db.createEmptyGame();
  console.log("========================================");
  console.log("NEW GAME CREATED!");
  console.log(`Game ID: ${game.id}`);
  console.log("Waiting for player registration...");
  console.log("========================================");
  return game;
}

// Re-export for consumers reaching the store through gameState.
export function requireDb(): Database {
  if (!gameState.db) throw new Error("database not initialised");
  return gameState.db;
}
