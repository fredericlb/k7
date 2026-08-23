import type { Request, Response } from "express";
import { gameState } from "../gameState.ts";
import type { Song } from "../session/model.ts";
import type { NextItem } from "../session/progress.ts";
import { loadGameFromGrist, savePersistedState } from "../state/persist.ts";
import { loadAndSwapGristSession } from "../state/sessionControl.ts";
import {
  broadcastBumpMessage,
  broadcastPlayerAdded,
  broadcastRegistrationState,
  setServerPhase,
} from "./phase.ts";

// HTTP handlers for the live game; the wire shapes here are what every SPA consumes.

/** Prefix bare song paths with /audio/ so the frontend fetches them directly. */
const prefixAudioPath = (p: string | undefined): string | undefined => {
  if (p && !p.startsWith("/") && !p.startsWith("http")) return `/audio/${p}`;
  return p;
};

function prefixSong(song: Song): void {
  song.path = prefixAudioPath(song.path);
  song.fullSong = prefixAudioPath(song.fullSong);
  for (const t of song.tracks ?? []) {
    t.path = prefixAudioPath(t.path);
    t.fullSong = prefixAudioPath(t.fullSong);
  }
}

/** Apply /audio/ prefixing to every path a NextItem exposes. */
export function prefixNextItem(item: NextItem): void {
  if (item.song) prefixSong(item.song);
  if (item.category) for (const s of item.category.songs) prefixSong(s);
}

/** 412 + JSON error when no game is selected (main.go requireGame). */
function requireGame(res: Response): boolean {
  const ok = gameState.gameSelected && gameState.currentGame !== null;
  if (!ok) res.status(412).json({ error: "no game selected" });
  return ok;
}

// GET /players — name → deviceId map.
export function getPlayers(_req: Request, res: Response): void {
  if (!requireGame(res)) return;
  const players: Record<string, string> = {};
  for (const p of gameState.currentGame!.players) players[p.name] = p.deviceId;
  res.json(players);
}

// GET /game — game info, players, session progress, current item.
export function getGameInfo(_req: Request, res: Response): void {
  if (!requireGame(res)) return;
  const game = gameState.currentGame!;
  const sp = gameState.sessionProgress;

  const gameInfo: Record<string, unknown> = {
    gameSelected: true,
    id: game.id,
    createdAt: game.createdAt,
    players: game.players.map((p) => ({
      name: p.name,
      deviceId: p.deviceId,
      score: p.score,
    })),
    registrationStarted: gameState.registrationStarted,
    registrationComplete: gameState.registrationComplete,
    sessionStarted: sp?.isStarted() ?? false,
    phase: gameState.currentPhase,
    connectedDevices: gameState.hub?.connectedBuzzerDevices() ?? [],
    totalSongs: sp?.totalSongs() ?? 0,
  };

  const current = sp?.current() ?? null;
  if (current) {
    prefixNextItem(current);
    gameInfo.currentItem = current;
    // Current category songs for preloading on resume.
    const catSongs = sp!.currentCategorySongs();
    if (catSongs.length > 0) {
      const songs = catSongs.map((s) => ({
        ...s,
        tracks: s.tracks?.map((t) => ({ ...t })),
      }));
      for (const s of songs) prefixSong(s);
      gameInfo.categorySongs = songs;
    }
  }

  res.json(gameInfo);
}

// GET /games — id/createdAt/playerCount of every known game.
export function handleListGames(_req: Request, res: Response): void {
  const games = gameState.db?.listGames() ?? [];
  res.json({
    games: games.map((g) => ({
      id: g.id,
      createdAt: g.createdAt,
      playerCount: g.players.length,
    })),
  });
}

/** A HARD swap to gameId's Grist snapshot: connected clients see it on the next broadcast. */
export async function resumeGameFromGrist(gameId: string): Promise<void> {
  if (gameId === "") throw new Error("gameId required");
  const ps = await loadGameFromGrist(gameId);
  if (!ps) throw new Error(`no persisted state for game "${gameId}"`);
  const db = gameState.db;
  if (!db) throw new Error("database not initialised");

  let game;
  try {
    game = db.getGame(gameId);
  } catch {
    game = db.createEmptyGameWithId(gameId);
  }
  if (ps.createdAt) game.createdAt = ps.createdAt;
  game.players = ps.players.map((p) => ({
    name: p.name,
    deviceId: p.deviceId,
    score: p.score,
  }));
  db.replaceGame(game);

  gameState.currentGame = game;
  gameState.gameSelected = true;
  gameState.currentPhase = ps.phase;

  if (ps.gristSessionId > 0) {
    try {
      await loadAndSwapGristSession(ps.gristSessionId);
    } catch (err) {
      console.log(
        `[State] resume: load Grist session ${ps.gristSessionId} failed: ${err}`,
      );
    }
  }
  gameState.sessionProgress?.restore(
    ps.orderIndex,
    ps.songIndex,
    ps.started,
    ps.finished,
  );
  console.log(
    `[State] Resumed game ${gameId} (phase="${ps.phase}" orderIndex=${ps.orderIndex} songIndex=${ps.songIndex} players=${ps.players.length})`,
  );
}

// POST /games/:id/resume — make a previously-played game active again.
export async function handleGameResume(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    await resumeGameFromGrist(String(req.params.id ?? ""));
  } catch (err) {
    res
      .status(404)
      .json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  const game = gameState.currentGame!;
  res.json({ id: game.id, playerCount: game.players.length });
}

// POST /players/add — buzzer self-registration over HTTP.
export function handleAddPlayer(req: Request, res: Response): void {
  if (!requireGame(res)) return;
  if (!gameState.registrationStarted) {
    res.status(400).json({ error: "Registration has not started yet" });
    return;
  }
  if (gameState.registrationComplete) {
    res.status(400).json({ error: "Registration is already complete" });
    return;
  }
  const name = String(req.body?.name ?? "");
  const deviceId = String(req.body?.deviceId ?? "");
  if (name === "" || deviceId === "") {
    res.status(400).json({ error: "name and deviceId are required" });
    return;
  }

  const db = gameState.db!;
  try {
    db.addPlayer(gameState.currentGame!.id, name, deviceId);
  } catch (err) {
    res
      .status(409)
      .json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  gameState.currentGame = db.getGame(gameState.currentGame!.id);

  console.log(`Player added: ${name} (device: ${deviceId})`);
  if (deviceId.startsWith("P")) gameState.hub?.notifyRegistered(deviceId, name);
  broadcastPlayerAdded(name, deviceId);

  res.json({
    players: gameState.currentGame.players.map((p) => ({
      name: p.name,
      deviceId: p.deviceId,
    })),
  });
}

// POST /players/unlock — clear a player's device binding (admin).
export function handleUnlockPlayer(req: Request, res: Response): void {
  if (!requireGame(res)) return;
  const playerName = String(req.body?.playerName ?? "");
  if (playerName === "") {
    res.status(400).json({ error: "playerName required" });
    return;
  }

  const prevDeviceId =
    gameState.currentGame!.players.find(
      (p) => p.name.toLowerCase() === playerName.toLowerCase(),
    )?.deviceId ?? "";

  const db = gameState.db!;
  try {
    db.unlinkPlayerDevice(gameState.currentGame!.id, playerName);
  } catch (err) {
    res
      .status(404)
      .json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  gameState.currentGame = db.getGame(gameState.currentGame!.id);

  if (prevDeviceId !== "") {
    gameState.hub?.notifyBuzzerDevice(prevDeviceId, {
      type: "unregistered",
      payload: { deviceId: prevDeviceId },
    });
  }
  gameState.hub?.broadcastMain({
    type: "player_unlocked",
    payload: { playerName, prevDeviceId },
  });

  console.log(
    `[Unlock] Player ${playerName} unlinked from device ${prevDeviceId}`,
  );
  res.json({ status: "ok" });
}

// POST /players/done — finalize registration (admin).
export function handleDoneRegistration(_req: Request, res: Response): void {
  if (!requireGame(res)) return;
  if (gameState.registrationComplete) {
    res.status(400).json({ error: "Registration is already complete" });
    return;
  }
  if (gameState.currentGame!.players.length === 0) {
    res.status(400).json({ error: "No players registered" });
    return;
  }
  gameState.registrationComplete = true;
  console.log(
    `Registration complete with ${gameState.currentGame!.players.length} players`,
  );
  broadcastRegistrationState();

  const players: Record<string, string> = {};
  for (const p of gameState.currentGame!.players) players[p.name] = p.deviceId;
  res.json({ players });
}

// POST /registration — open/close registration (admin). Body: {"locked": bool}.
export function handleSetRegistration(req: Request, res: Response): void {
  if (!requireGame(res)) return;
  if (typeof req.body?.locked !== "boolean") {
    res.status(400).json({ error: "invalid body" });
    return;
  }
  const locked: boolean = req.body.locked;
  gameState.registrationComplete = locked;
  if (!locked) {
    gameState.registrationStarted = true;
    // Reopening must unlock the buzzers, so a joining player can confirm their device.
    setServerPhase("registration");
  }
  console.log(
    `[Registration] locked=${locked} started=${gameState.registrationStarted} (remote toggle)`,
  );
  broadcastRegistrationState();
  res.json({ locked });
}

// POST /next — advance the session (admin).
export function handleNext(_req: Request, res: Response): void {
  const item = gameState.sessionProgress!.next();
  savePersistedState();
  prefixNextItem(item);
  console.log(
    `[Session] Next -> type=${item.type}, category=${item.categoryName}, finished=${item.finished}`,
  );

  // Phase BEFORE the item, so a client deriving its render phase from "next" wins the tick.
  transitionForItem(item);
  gameState.hub?.broadcastMain({ type: "next", payload: item });
  res.json(item);
}

// POST /next-category — skip to the next slot's intro (admin).
export function handleNextCategory(_req: Request, res: Response): void {
  const sp = gameState.sessionProgress!;
  if (!sp.skipToNextCategory()) {
    const item: NextItem = { type: "end", finished: true };
    savePersistedState();
    gameState.hub?.broadcastMain({ type: "next", payload: item });
    res.json(item);
    return;
  }
  const item = sp.next();
  savePersistedState();
  prefixNextItem(item);
  console.log(
    `[Session] NextCategory -> type=${item.type}, category=${item.categoryName}, finished=${item.finished}`,
  );
  transitionForItem(item);
  gameState.hub?.broadcastMain({ type: "next", payload: item });
  res.json(item);
}

// GET /peek — preview the next item without advancing (admin).
export function handlePeek(_req: Request, res: Response): void {
  res.json(gameState.sessionProgress!.peek());
}

/** Canonical phase for a /next item (main.go nextItemPhase). */
function transitionForItem(item: NextItem): void {
  if (item.finished) {
    setServerPhase("end");
    return;
  }
  if (item.type === "category" || item.type === "song")
    setServerPhase(item.type);
}

/** Increment the score of the player bound to deviceId, returning [name, newScore]. */
export function bumpPlayer(deviceId: string): [string, number] {
  const game = gameState.currentGame!;
  const player = game.players.find((p) => p.deviceId === deviceId);
  if (!player) throw new Error(`player not found for device: ${deviceId}`);

  const newScore = player.score + 1;
  gameState.db!.updatePlayerScore(game.id, deviceId, newScore);
  player.score = newScore;
  broadcastBumpMessage(player.name);
  return [player.name, newScore];
}

// POST /bump — force-buzz/score by deviceId (admin). Body: {entity, value}.
export function handleBump(req: Request, res: Response): void {
  if (!requireGame(res)) return;
  const deviceId = String(req.body?.entity ?? "");
  if (deviceId === "") {
    res.status(400).json({ error: "entity field is required" });
    return;
  }
  let playerName: string, newScore: number;
  try {
    [playerName, newScore] = bumpPlayer(deviceId);
  } catch (err) {
    console.log(`Bump failed: ${err}`);
    res
      .status(404)
      .json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  res.json({
    entity: deviceId,
    player: playerName,
    score: newScore,
    value: req.body?.value,
    status: "bumped",
  });
}

// POST /score — +1 a player by name (admin).
export function handleScore(req: Request, res: Response): void {
  if (!requireGame(res)) return;
  const playerName = String(req.body?.playerName ?? "");
  if (playerName === "") {
    res.status(400).json({ error: "playerName required" });
    return;
  }
  const deviceId = gameState.currentGame!.players.find(
    (p) => p.name === playerName,
  )?.deviceId;
  if (!deviceId) {
    res.status(404).json({ error: "player not found" });
    return;
  }
  let name: string, newScore: number;
  try {
    [name, newScore] = bumpPlayer(deviceId);
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  console.log(`[Score] ${name} scored (new total: ${newScore})`);
  res.json({ player: name, score: newScore });
}

// POST /score/set — set a player's score to an exact value (admin).
export function handleScoreSet(req: Request, res: Response): void {
  if (!requireGame(res)) return;
  const playerName = String(req.body?.playerName ?? "");
  const score = Number(req.body?.score ?? NaN);
  if (playerName === "" || Number.isNaN(score)) {
    res.status(400).json({ error: "playerName and score required" });
    return;
  }
  const game = gameState.currentGame!;
  const player = game.players.find((p) => p.name === playerName);
  if (!player || player.deviceId === "") {
    res.status(404).json({ error: "player not found" });
    return;
  }
  try {
    gameState.db!.updatePlayerScore(game.id, player.deviceId, score);
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : String(err) });
    return;
  }
  player.score = score;
  const msg = { type: "score_set", payload: { player: playerName, score } };
  gameState.hub?.broadcastMain(msg);
  gameState.hub?.broadcastBuzzers(msg);
  console.log(`[Score] ${playerName} set to ${score}`);
  res.json({ player: playerName, score });
}
