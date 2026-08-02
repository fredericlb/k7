import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Database } from "../db.ts";
import { gameState } from "../gameState.ts";
import { GristClient, type GristRecord } from "../grist/client.ts";
import { SessionProgress } from "../session/progress.ts";
import {
  flushNowForTest,
  loadAllPersistedStates,
  loadBuzzerState,
  parsePhoneId,
  saveBuzzerState,
  savePersistedState,
  startStateWorker,
} from "./persist.ts";

// A mutable stub Grist doc: full records CRUD so the write-behind worker and
// the hydrate path can round-trip against it.

let tables: Record<string, GristRecord[]>;
let nextId: number;
let requests: { method: string; path: string }[];

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    requests.push({ method: req.method ?? "", path: url.pathname });
    const send = (v: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(v));
    };
    const m = url.pathname.match(/^\/api\/docs\/DOC\/tables\/(\w+)\/records$/);
    if (!m) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const table = (tables[m[1]] ??= []);

    if (req.method === "GET") {
      let rows = table;
      const rawFilter = url.searchParams.get("filter");
      if (rawFilter) {
        const filter = JSON.parse(rawFilter) as Record<string, unknown[]>;
        for (const [col, vals] of Object.entries(filter)) {
          rows = rows.filter((r) =>
            vals.includes(col === "id" ? r.id : r.fields[col]),
          );
        }
      }
      send({ records: rows });
      return;
    }

    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      const payload = JSON.parse(body) as {
        records: { id?: number; fields: Record<string, unknown> }[];
      };
      if (req.method === "POST") {
        const created: { id: number }[] = [];
        for (const r of payload.records) {
          const id = nextId++;
          table.push({ id, fields: r.fields });
          created.push({ id });
        }
        send({ records: created });
        return;
      }
      if (req.method === "PATCH") {
        for (const r of payload.records) {
          const row = table.find((x) => x.id === r.id);
          if (row) Object.assign(row.fields, r.fields);
        }
        send(null);
        return;
      }
      res.statusCode = 405;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => server.close());

beforeEach(() => {
  tables = {};
  nextId = 1000;
  requests = [];
  gameState.gristClient = new GristClient({
    url: base,
    apiKey: "",
    docId: "DOC",
  });
  gameState.db = null;
  gameState.currentGame = null;
  gameState.currentPhase = "";
  gameState.sessionProgress = null;
  gameState.activeSessionId = 0;
  gameState.buzzerTokens = new Map();
  gameState.phoneCounter = 0;
  startStateWorker({ debounceMs: 5 });
});

describe("write-behind game flush", () => {
  it("creates the Games row, upserts players, and backfills the game ref", async () => {
    const db = new Database();
    gameState.db = db;
    const game = db.createEmptyGameWithId("ABC123");
    gameState.currentGame = game;
    gameState.currentPhase = "song";
    gameState.sessionProgress = new SessionProgress({
      categories: [
        {
          name: "C",
          mode: "",
          illustration: "",
          songs: [{ artist: "a", title: "t" }],
        },
      ],
    });
    gameState.sessionProgress.next(); // started
    gameState.activeSessionId = 42;

    db.addPlayer("ABC123", "Alice", "P1");
    db.addPlayer("ABC123", "Bob", "P2");
    savePersistedState(); // burst — coalesces with the addPlayer enqueues
    await flushNowForTest();

    expect(tables.Games).toHaveLength(1);
    const g = tables.Games[0];
    expect(g.fields).toMatchObject({
      gameId: "ABC123",
      phase: "song",
      started: true,
      finished: false,
      session: 42,
    });

    expect(tables.GamePlayers).toHaveLength(2);
    for (const p of tables.GamePlayers) {
      expect(p.fields.game).toBe(g.id); // backfilled ref
    }

    // Burst coalescing: exactly one Games row POST despite three enqueues.
    const gamePosts = requests.filter(
      (r) => r.method === "POST" && r.path.endsWith("/Games/records"),
    );
    expect(gamePosts).toHaveLength(1);
  });

  it("updates in place on the second flush (row-id cache)", async () => {
    const db = new Database();
    gameState.db = db;
    const game = db.createEmptyGameWithId("XYZ999");
    gameState.currentGame = game;
    db.addPlayer("XYZ999", "Alice", "P1");
    await flushNowForTest();

    db.updatePlayerScore("XYZ999", "P1", 2.5);
    await flushNowForTest();

    expect(tables.Games).toHaveLength(1); // still one row
    expect(tables.GamePlayers).toHaveLength(1);
    expect(tables.GamePlayers[0].fields.score).toBe(2.5);
  });
});

describe("buzzer flush + restore", () => {
  it("round-trips tokens and bumps phoneCounter above the highest P<n>", async () => {
    gameState.buzzerTokens = new Map([
      ["tok-a", "P3"],
      ["tok-b", "P7"],
    ]);
    gameState.phoneCounter = 2;
    saveBuzzerState();
    await flushNowForTest();

    expect(tables.Buzzers).toHaveLength(2);
    expect(tables.Counters).toHaveLength(1);
    expect(tables.Counters[0].fields).toMatchObject({
      name: "phoneCounter",
      value: 2,
    });

    // Fresh state restores from Grist; counter bumps to max(P<n>) = 7.
    gameState.buzzerTokens = new Map();
    gameState.phoneCounter = 0;
    await loadBuzzerState();
    expect(gameState.buzzerTokens.get("tok-a")).toBe("P3");
    expect(gameState.phoneCounter).toBe(7);
  });

  it("parsePhoneId parses P<n> and rejects the rest", () => {
    expect(parsePhoneId("P12")).toBe(12);
    expect(parsePhoneId("X2")).toBeNull();
    expect(parsePhoneId("P-1")).toBeNull();
    expect(parsePhoneId("Px")).toBeNull();
  });
});

describe("hydrate", () => {
  it("Database.create rebuilds games and players from Grist", async () => {
    tables.Games = [
      {
        id: 1,
        fields: {
          gameId: "OLD001",
          createdAt: 1700000000,
          phase: "song",
          started: true,
          finished: false,
        },
      },
    ];
    tables.GamePlayers = [
      { id: 2, fields: { game: 1, name: "Zoe", deviceId: "P9", score: 4.5 } },
    ];

    const db = await Database.create();
    const game = db.getGame("OLD001");
    expect(game.players).toEqual([{ name: "Zoe", deviceId: "P9", score: 4.5 }]);
    expect(game.createdAt.getTime()).toBe(1700000000 * 1000);

    const all = await loadAllPersistedStates();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      gameId: "OLD001",
      phase: "song",
      started: true,
    });
  });
});
