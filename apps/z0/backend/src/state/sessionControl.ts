import type { Request, Response } from "express";
import { gameState } from "../gameState.ts";
import {
  type LoadProgressFn,
  listGristSessions,
  loadSessionFromGrist,
} from "../grist/load.ts";
import { SessionProgress } from "../session/progress.ts";
import { savePersistedState } from "./persist.ts";

// The active Grist session; its id lives on gameState.activeSessionId and nowhere else.

/** The BOOT path: no broadcast and no write, since persisted positions land right after. */
export async function loadAndSwapGristSession(
  id: number,
  progress?: LoadProgressFn,
): Promise<void> {
  const g = gameState.gristClient;
  if (!g) throw new Error("grist client not configured");
  const session = await loadSessionFromGrist(g, id, progress);
  gameState.sessionProgress = new SessionProgress(session);
  gameState.activeSessionId = id;
}

/** The RUNTIME path; phase, players and game id survive — this is a new track list, not a new game. */
export async function activateGristSession(
  id: number,
  source: string,
): Promise<void> {
  const progress: LoadProgressFn = (done, total, name) => {
    gameState.hub?.broadcastMain({
      type: "session_loading",
      payload: { id, done, total, name },
    });
  };
  await loadAndSwapGristSession(id, progress);

  savePersistedState();

  const session = gameState.sessionProgress?.session;
  const categories = session?.categories.length ?? 0;
  const orderEntries = session?.order?.length ?? 0;

  gameState.hub?.broadcastMain({
    type: "session_selected",
    payload: { id, categories, orderEntries },
  });
  gameState.hub?.broadcastBuzzers({
    type: "session_selected",
    payload: { id },
  });

  console.log(
    `[Session] Activated Grist session id=${id} (${categories} categories) — source=${source}`,
  );
}

/** GET /sessions — the Grist session catalogue for the monitor's picker. */
export async function handleListGristSessions(
  _req: Request,
  res: Response,
): Promise<void> {
  if (!gameState.gristClient) {
    res.status(503).json({ error: "grist not configured" });
    return;
  }
  let sessions;
  try {
    sessions = await listGristSessions(gameState.gristClient);
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  res.json({
    sessions: sessions.map((s) => ({ id: s.id, name: s.name })),
    activeId: gameState.activeSessionId,
  });
}

/** POST /sessions/select — activate the requested session. Body: {"id": n}. */
export async function handleSelectGristSession(
  req: Request,
  res: Response,
): Promise<void> {
  const id = Number(req.body?.id ?? 0);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "missing or invalid id" });
    return;
  }
  try {
    await activateGristSession(id, "monitor");
  } catch (err) {
    res.status(502).json({ error: String(err) });
    return;
  }
  res.json({ ok: true, id });
}
