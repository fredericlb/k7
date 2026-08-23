import { createServer, type Server } from "node:http";
import { sessionCookieHeader, sessionMiddleware } from "@frediverse/oidc";
import express from "express";
import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import { initSessionAuth, SESSION_COOKIE_NAME } from "../auth/session.ts";
import { loadAppConfig } from "../config.ts";
import { Database } from "../db.ts";
import { gameState } from "../gameState.ts";
import { authMiddleware, cors } from "../middleware.ts";
import { registerRoutes } from "../routes.ts";
import { SessionProgress } from "../session/progress.ts";
import { WsHub } from "../ws.ts";

// A whole game over real WebSockets: two buzzers race the 150 ms window, the earliest wins, judged.

const SECRET = "game-test-secret-0123456789abcdef";

// Set first, then minted from the RESOLVED config, so a local env.yaml cannot disagree with us.
process.env.SESSION_SECRET = SECRET;
process.env.AUTH_ADMIN_GROUPS = "blindtest-admins";
const authConfig = loadAppConfig().auth;

const cookie = (groups: string[]) =>
  sessionCookieHeader(
    { kind: "user", sub: "s", groups },
    { cookieName: SESSION_COOKIE_NAME, secret: authConfig.sessionSecret },
  );

class WsClient {
  messages: { type: string; payload?: unknown }[] = [];
  ws!: WebSocket;

  static async connect(
    url: string,
    headers: Record<string, string>,
  ): Promise<WsClient> {
    const c = new WsClient();
    c.ws = new WebSocket(url, { headers });
    c.ws.on("message", (raw) => c.messages.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => {
      c.ws.on("open", resolve);
      c.ws.on("error", reject);
    });
    return c;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor(
    type: string,
    match?: (payload: unknown) => boolean,
    timeoutMs = 2000,
  ): Promise<{ type: string; payload?: unknown }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.messages.find(
        (m) => m.type === type && (!match || match(m.payload)),
      );
      if (found) return found;
      if (Date.now() > deadline)
        throw new Error(
          `timeout waiting for "${type}" (got: ${this.messages.map((m) => m.type).join(",")})`,
        );
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  all(type: string): { type: string; payload?: unknown }[] {
    return this.messages.filter((m) => m.type === type);
  }

  close(): void {
    this.ws.close();
  }
}

let server: Server;
let base: string;
let wsBase: string;
let hub: WsHub;
const ADMIN = cookie(authConfig.adminGroups);
const USER = cookie(["users"]);

beforeAll(async () => {
  initSessionAuth(authConfig);

  // Assemble the app exactly like server.ts, minus the Grist boot.
  gameState.gristClient = null; // persistence no-ops
  gameState.db = new Database();
  gameState.currentGame = gameState.db.createEmptyGameWithId("TEPL81");
  gameState.gameSelected = true;
  gameState.registrationStarted = true;
  gameState.registrationComplete = false;
  gameState.currentPhase = "";
  gameState.buzzersLocked = false;
  gameState.sessionProgress = new SessionProgress({
    categories: [
      {
        name: "Rock",
        mode: "",
        illustration: "",
        songs: [
          { artist: "A1", title: "T1", path: "grist/t1.webm" },
          { artist: "A2", title: "T2", path: "grist/t2.webm" },
        ],
      },
    ],
  });

  const app = express();
  app.set("trust proxy", true);
  app.use(cors);
  app.use(
    sessionMiddleware({
      cookieName: SESSION_COOKIE_NAME,
      secret: authConfig.sessionSecret,
    }),
  );
  app.use(authMiddleware);
  app.use(express.json());
  registerRoutes(app);

  hub = new WsHub();
  gameState.hub = hub;
  server = createServer(app);
  server.on("upgrade", (req, socket, head) =>
    hub.handleUpgrade(req, socket, head),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});

afterAll(() => {
  hub.close();
  server.close();
});

const post = (path: string, body: unknown, c = ADMIN) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: c },
    body: JSON.stringify(body),
  });

it("plays a full round: register → done → next → buzz race → judge → score", async () => {
  // WS auth: no cookie → rejected; monitor role needs admin.
  await expect(WsClient.connect(`${wsBase}/ws`, {})).rejects.toThrow();
  await expect(
    WsClient.connect(`${wsBase}/ws?role=monitor`, { Cookie: USER }),
  ).rejects.toThrow();

  const monitor = await WsClient.connect(`${wsBase}/ws?role=monitor`, {
    Cookie: ADMIN,
  });
  const connected = await monitor.waitFor("connected");
  expect(connected.payload).toMatchObject({
    gameSelected: true,
    gameId: "TEPL81",
  });

  // Two buzzers connect with tokens (users, not admins) and register.
  const alice = await WsClient.connect(`${wsBase}/ws/buzzer?token=tok-alice`, {
    Cookie: USER,
  });
  const aliceWelcome = await alice.waitFor("welcome");
  const aliceId = (aliceWelcome.payload as { deviceId: string }).deviceId;
  expect(aliceId).toMatch(/^P\d+$/);

  const bob = await WsClient.connect(`${wsBase}/ws/buzzer?token=tok-bob`, {
    Cookie: USER,
  });
  const bobWelcome = await bob.waitFor("welcome");
  const bobId = (bobWelcome.payload as { deviceId: string }).deviceId;
  expect(bobId).not.toBe(aliceId);

  alice.send({ type: "register", payload: { name: "Alice" } });
  await alice.waitFor("registered");
  bob.send({ type: "register", payload: { name: "Bob" } });
  await bob.waitFor("registered");
  expect(monitor.all("player_added")).toHaveLength(2);

  // Duplicate name is rejected.
  bob.send({ type: "register", payload: { name: "alice" } });
  await bob.waitFor("register_error");

  // Admin closes registration; a user hitting the admin route gets 403.
  expect((await post("/players/done", {}, USER)).status).toBe(403);
  expect((await post("/players/done", {})).status).toBe(200);

  // Advance: category intro, then the first song — buzzers unlock on "song".
  const catRes = await (await post("/next", {})).json();
  expect(catRes).toMatchObject({ type: "category", categoryName: "Rock" });
  expect(gameState.currentPhase).toBe("category");

  const songRes = (await (await post("/next", {})).json()) as {
    song: { path: string };
  };
  expect(songRes).toMatchObject({ type: "song" });
  expect(songRes.song.path).toBe("/audio/grist/t1.webm"); // /audio/ prefixing
  expect(gameState.currentPhase).toBe("song");
  await alice.waitFor("buzzer_locked"); // locked:false broadcast on unlock
  expect(gameState.buzzersLocked).toBe(false);

  // Both buzz into the 150ms window; Alice's timestamp is earlier and wins.
  const qStart = gameState.questionStartedAt;
  bob.send({ type: "buzz", payload: { timestamp: qStart + 100 } });
  alice.send({ type: "buzz", payload: { timestamp: qStart + 50 } });
  const buzz = await monitor.waitFor("player_buzz");
  expect(buzz.payload).toMatchObject({
    playerName: "Alice",
    deviceId: aliceId,
  });
  expect(gameState.currentPhase).toBe("answering");
  expect(gameState.buzzersLocked).toBe(true);

  // A late buzz while answering is rejected as locked.
  bob.send({ type: "buzz", payload: { timestamp: qStart + 200 } });
  const rejected = await bob.waitFor("buzz_rejected");
  expect(rejected.payload).toMatchObject({ reason: "locked" });

  // The remote judges: score_and_reveal → phase reveal (via main WS).
  monitor.send({
    type: "remote_action",
    payload: { action: "score_and_reveal" },
  });
  await monitor.waitFor(
    "phase_change",
    (p) => (p as { phase: string }).phase === "reveal",
  );
  expect(gameState.currentPhase).toBe("reveal");

  // Score Alice (+1) and read the game snapshot back.
  const scored = (await (
    await post("/score", { playerName: "Alice" })
  ).json()) as {
    player: string;
    score: number;
  };
  expect(scored).toEqual({ player: "Alice", score: 1 });

  const info = (await (
    await fetch(`${base}/game`, { headers: { Cookie: USER } })
  ).json()) as {
    players: { name: string; score: number }[];
    phase: string;
    totalSongs: number;
  };
  expect(info.phase).toBe("reveal");
  expect(info.totalSongs).toBe(2);
  expect(info.players.find((p) => p.name === "Alice")?.score).toBe(1);

  monitor.close();
  alice.close();
  bob.close();
});

it("token reconnection re-binds the same device and player", async () => {
  // Alice's phone reconnects with the same token: same device id, registered.
  const alice2 = await WsClient.connect(`${wsBase}/ws/buzzer?token=tok-alice`, {
    Cookie: USER,
  });
  const welcome = await alice2.waitFor("welcome");
  expect((welcome.payload as { reconnected: boolean }).reconnected).toBe(true);
  const registered = await alice2.waitFor("registered");
  expect(registered.payload).toMatchObject({ playerName: "Alice", score: 1 });
  alice2.close();
});
