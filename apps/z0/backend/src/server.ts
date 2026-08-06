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

// Boot sequence: config → session auth → routes (OIDC discovery happens inside
// setupAuth, below) → HTTP server with the two WebSocket upgrade endpoints →
// graceful shutdown on SIGINT/TERM. The .env files are loaded by `node
// --env-file-if-exists` (see package.json), with real process env winning.
const config = loadAppConfig();
initSessionAuth(config.auth);

// CLI flags (main.go's flag set — the one-shot Grist tools are not ported yet).
const { values: flags } = parseArgs({
  options: {
    continue: { type: "string", default: "" },
    "game-id": { type: "string", default: "" },
    latest: { type: "boolean", default: false },
  },
  strict: false,
});

// Grist-backed state: schema bootstrap, hydrate the game store, start the
// write-behind worker, pick a game, restore phase/session/buzzers. Without
// Grist config the server still boots (auth + static routes work; game state
// is memory-only and no game is selected).
gameState.sessionProgress = new SessionProgress(emptySession());
if (config.grist.url && config.grist.docId) {
  gameState.gristClient = new GristClient(config.grist);
  await ensureGristSchema(gameState.gristClient);
  gameState.db = await Database.create();
  startStateWorker();
  console.log(
    "[Session] Booted with empty placeholder — pick one via the monitor UI.",
  );

  // Pick a game at startup — always end up with one selected (main.go):
  //   --game-id <id>  → resume if it exists, else create with that id
  //   --continue <id> → resume existing (errors if missing)
  //   --latest        → resume the most recent game
  //   (none)          → create a fresh game with a random id
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

  // Restore buzzer token→deviceId map + phone counter, then persist game
  // metadata so even a brand-new empty game is visible to --latest.
  await loadBuzzerState();
  savePersistedState();
} else {
  console.log("[State] Grist not configured — game persistence disabled");
}

const app = express();
app.set("trust proxy", true);
app.use(cors);
// Installs cookie-session for `bt_session` — the GUEST cookie, all this backend
// still mints — and mounts NO routes. Must come before authMiddleware, which
// reads the session it decodes.
//
// It used to mount login + callback: z0 ran its own OIDC flow, on its own
// backend, so that a player could be a guest with no account. The guests
// survived; the flow did not. `redirectUriFor` named
// <origin>/z0/auth/callback (the Caddyfile set X-Forwarded-Prefix for exactly
// that), and the IdP has only the prefixless callback registered on this
// client — so every account login died at the authorization endpoint with
// "the 'redirect_uri' parameter does not match any of the pre-registered
// 'redirect_uris'". A service under a path cannot own a flow here. st0 does,
// because it has no prefix; this reads the cookie st0 mints. docs/auth.md.
await setupAuth(app, {
  cookieName: SESSION_COOKIE_NAME,
  service: "z0-backend",
  mountRoutes: [],
});
app.use(authMiddleware);
app.use(express.json({ limit: "32mb" })); // editor attachment uploads are big
registerRoutes(app);

const hub = new WsHub();
gameState.hub = hub;
const server = createServer(app);
// /ws and /ws/buzzer sit behind the same origin; note they are NOT public
// paths — the auth sub-phase will gate the upgrade on the session cookie the
// same way authMiddleware gates HTTP routes.
server.on("upgrade", (req, socket, head) =>
  hub.handleUpgrade(req, socket, head),
);

const port = loadEnv().BACKEND_PORT;
server.listen(port, "0.0.0.0", () => {
  console.log(`[z0] backend listening on 0.0.0.0:${port}`);
});

// Graceful shutdown: flush pending Grist writes, drop WS clients, then exit —
// a clean Ctrl+C still persists state (main.go's StopStateWorker semantics).
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
