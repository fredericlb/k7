import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { setupAuth } from "@frediverse/oidc";
import express from "express";
import { initSessionAuth, SESSION_COOKIE_NAME } from "./auth/session.ts";
import { loadAppConfig } from "./config.ts";
import { Database, initializeGame } from "./db.ts";
import { loadEnv } from "./env.ts";
import { gameState } from "./gameState.ts";
import { GristClient } from "./grist/client.ts";
import { ensureGristSchema } from "./grist/schema.ts";
import { authMiddleware, cors } from "./middleware.ts";
import { registerRoutes } from "./routes.ts";
import { emptySession, SessionProgress } from "./session/progress.ts";
import {
  loadBuzzerState,
  loadPersistedState,
  savePersistedState,
  startStateWorker,
  stopStateWorker,
} from "./state/persist.ts";
import { loadAndSwapGristSession } from "./state/sessionControl.ts";
import { WsHub } from "./ws.ts";

// Boot: config → session auth → routes → the two WS upgrade endpoints → graceful shutdown.
const config = loadAppConfig();
initSessionAuth(config.auth);

// CLI flags: which game to continue, and how to name it.
const { values: flags } = parseArgs({
  options: {
    continue: { type: "string", default: "" },
    "game-id": { type: "string", default: "" },
    latest: { type: "boolean", default: false },
  },
  strict: false,
});

// Without Grist configured the server still boots, memory-only and with no game selected.
gameState.sessionProgress = new SessionProgress(emptySession());
if (config.grist.url && config.grist.docId) {
  gameState.gristClient = new GristClient(config.grist);
  await ensureGristSchema(gameState.gristClient);
  gameState.db = await Database.create();
  startStateWorker();
  console.log(
    "[Session] Booted with empty placeholder — pick one via the monitor UI.",
  );

  // --game-id resumes or creates, --continue resumes, --latest takes the newest, none makes one.
  const db = gameState.db;
  let continueId = String(flags.continue ?? "");
  const gameIdFlag = String(flags["game-id"] ?? "");
  if (flags.latest && continueId === "" && gameIdFlag === "") {
    try {
      const latest = db.getLatestGame();
      continueId = latest.id;
      console.log(
        `Resuming latest game: ${latest.id} (created ${latest.createdAt.toISOString()})`,
      );
    } catch {
      console.log("No previous game found, starting fresh");
    }
  }
  if (gameIdFlag !== "") {
    gameState.currentGame = db.hasGame(gameIdFlag)
      ? db.getGame(gameIdFlag)
      : db.createEmptyGameWithId(gameIdFlag);
    console.log(
      `Game ${gameIdFlag} selected (${gameState.currentGame.players.length} players)`,
    );
  } else {
    gameState.currentGame = initializeGame(db, continueId);
  }
  gameState.gameSelected = true;
  if (gameState.currentGame.players.length > 0) {
    gameState.registrationStarted = true;
    gameState.registrationComplete = true;
    console.log(
      `Registration complete (${gameState.currentGame.players.length} players)`,
    );
  }

  // Restore phase + session progress so a restart resumes where it stopped.
  const ps = await loadPersistedState(gameState.currentGame.id);
  if (ps) {
    gameState.currentPhase = ps.phase;
    if (ps.gristSessionId > 0) {
      try {
        await loadAndSwapGristSession(ps.gristSessionId);
        console.log(`[State] Restored Grist session id=${ps.gristSessionId}`);
      } catch (err) {
        console.log(
          `[State] Failed to restore Grist session ${ps.gristSessionId}: ${err} — booting empty`,
        );
      }
    }
    gameState.sessionProgress.restore(
      ps.orderIndex,
      ps.songIndex,
      ps.started,
      ps.finished,
    );
    console.log(
      `[State] Restored phase="${ps.phase}" orderIndex=${ps.orderIndex} songIndex=${ps.songIndex} started=${ps.started} finished=${ps.finished}`,
    );
  }

  // Persist right after restoring, so even a brand-new empty game is visible to --latest.
  await loadBuzzerState();
  savePersistedState();
} else {
  console.log("[State] Grist not configured — game persistence disabled");
}

const app = express();
app.set("trust proxy", true);
app.use(cors);
// cookie-session for the GUEST cookie and NO routes — see ../../docs/auth.md.
await setupAuth(app, {
  cookieName: SESSION_COOKIE_NAME,
  service: "z0-backend",
  mountRoutes: [],
  // This app stays single-origin (../../docs/auth.md, config.test.ts) even
  // though env.yaml's common.COOKIE_DOMAIN now shares "studio.sid" across
  // st0/pl8/k7's subdomains — "" opts THIS cookie (a different name, the
  // guest session) out of that, rather than silently broadening it too.
  cookieDomain: "",
});
app.use(authMiddleware);
app.use(express.json({ limit: "32mb" })); // editor attachment uploads are big
registerRoutes(app);

const hub = new WsHub();
gameState.hub = hub;
const server = createServer(app);
// /ws and /ws/buzzer are NOT public paths: the upgrade is gated on the same cookie.
server.on("upgrade", (req, socket, head) =>
  hub.handleUpgrade(req, socket, head),
);

const port = loadEnv().BACKEND_PORT;
server.listen(port, "0.0.0.0", () => {
  console.log(`[z0] backend listening on 0.0.0.0:${port}`);
});

// Flush pending Grist writes before exiting, so a clean Ctrl+C still persists the state.
function shutdown(signal: string): void {
  console.log(`[z0] ${signal} — shutting down`);
  hub.close();
  void stopStateWorker().finally(() => {
    server.close(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
