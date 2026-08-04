import { createServer, type Server } from "node:http";
import { sessionCookieHeader, sessionMiddleware } from "@frediverse/oidc";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initSessionAuth, SESSION_COOKIE_NAME } from "../auth/session.ts";
import { loadAppConfig } from "../config.ts";
import { gameState } from "../gameState.ts";
import { GristClient, type GristRecord } from "../grist/client.ts";
import { authMiddleware, cors } from "../middleware.ts";
import { registerRoutes } from "../routes.ts";

// Solo + online-guest flows against a stub Grist with records CRUD and
// BulkRemoveRecord (via /apply) support.

const SECRET = "solo-test-secret-0123456789abcdef";

// Mint with the same secret the app resolves, so this holds whether or not
// the local env.yaml defines SESSION_SECRET.
process.env.SESSION_SECRET = SECRET;
const authConfig = loadAppConfig().auth;

const cookieFor = (user: Record<string, unknown>) =>
  sessionCookieHeader(user, {
    cookieName: SESSION_COOKIE_NAME,
    secret: authConfig.sessionSecret,
  });
const USER = cookieFor({
  kind: "user",
  sub: "oidc-user-1",
  name: "Fred OIDC",
  groups: ["users"],
});

let tables: Record<string, GristRecord[]>;
let nextId: number;
let gristServer: Server;
let appServer: Server;
let base: string;

beforeAll(async () => {
  initSessionAuth(authConfig);

  gristServer = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (v: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(v));
    };
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      if (url.pathname === "/api/docs/DOC/apply") {
        // Only BulkRemoveRecord is used by these flows.
        for (const action of JSON.parse(body) as unknown[][]) {
          if (action[0] === "BulkRemoveRecord") {
            const table = tables[String(action[1])] ?? [];
            const ids = action[2] as number[];
            tables[String(action[1])] = table.filter(
              (r) => !ids.includes(r.id),
            );
          }
        }
        send(null);
        return;
      }
      const m = url.pathname.match(
        /^\/api\/docs\/DOC\/tables\/(\w+)\/records$/,
      );
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
  await new Promise<void>((resolve) =>
    gristServer.listen(0, "127.0.0.1", resolve),
  );
  const gAddr = gristServer.address();
  const gBase = `http://127.0.0.1:${typeof gAddr === "object" && gAddr ? gAddr.port : 0}`;
  gameState.gristClient = new GristClient({
    url: gBase,
    apiKey: "",
    docId: "DOC",
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
  appServer = createServer(app);
  await new Promise<void>((resolve) =>
    appServer.listen(0, "127.0.0.1", resolve),
  );
  const aAddr = appServer.address();
  base = `http://127.0.0.1:${typeof aAddr === "object" && aAddr ? aAddr.port : 0}`;
});

afterAll(() => {
  gristServer.close();
  appServer.close();
});

beforeEach(() => {
  tables = {
    Sessions: [
      {
        id: 1,
        fields: { name: "Quiz Night", urlToken: "qn-2024", order: ["L", 9] },
      },
      { id: 2, fields: { name: "No Token", urlToken: "", order: ["L"] } },
    ],
    Guests: [],
    Scores: [],
    SoloProgress: [],
  };
  nextId = 500;
});

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
const get = (path: string, cookie?: string) =>
  fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });

describe("online-guest flow", () => {
  it("claims a fresh identity, looks it up, renames, and rejects collisions", async () => {
    // Fresh claim (public route, no cookie).
    const claim = await post("/auth/guest-online", { username: "Fred" });
    expect(claim.status).toBe(200);
    const { guestId } = (await claim.json()) as { guestId: string };
    expect(guestId).toMatch(/^[0-9a-f]{32}$/);
    expect(claim.headers.get("set-cookie")).toContain("bt_session=");
    expect(tables.Guests).toHaveLength(1);

    // Lookup pre-fills the gate.
    const lookup = await get(`/auth/guest-lookup?id=${guestId}`);
    expect(await lookup.json()).toEqual({ subject: guestId, username: "Fred" });

    // A different visitor claiming "fred" collides case-insensitively.
    const collision = await post("/auth/guest-online", { username: "fred" });
    expect(collision.status).toBe(409);

    // The same guest renames.
    const rename = await post("/auth/guest-online", {
      guestId,
      username: "Freddo",
    });
    expect(rename.status).toBe(200);
    expect(tables.Guests[0].fields.username).toBe("Freddo");

    // A well-formed caller id survives a server-side row wipe.
    tables.Guests = [];
    const reclaim = await post("/auth/guest-online", {
      guestId,
      username: "Freddo",
    });
    expect(((await reclaim.json()) as { guestId: string }).guestId).toBe(
      guestId,
    );
  });

  it("rejects invalid usernames and unknown lookups", async () => {
    expect((await post("/auth/guest-online", { username: "" })).status).toBe(
      400,
    );
    expect(
      (await post("/auth/guest-online", { username: "x".repeat(33) })).status,
    ).toBe(400);
    expect((await get("/auth/guest-lookup?id=deadbeefdeadbeef")).status).toBe(
      404,
    );
    expect((await get("/auth/guest-lookup")).status).toBe(400);
  });

  it("resolves session url tokens publicly", async () => {
    const ok = await get("/sessions/by-token/qn-2024");
    expect(await ok.json()).toEqual({ id: 1, name: "Quiz Night" });
    expect((await get("/sessions/by-token/nope")).status).toBe(404);
  });
});

describe("solo score + progress", () => {
  it("first completion wins; completing clears the in-progress row", async () => {
    // Save progress mid-run, visible as `resume` in the listing.
    const prog = await post(
      "/solo/sessions/1/progress",
      { orderIndex: 2, songIndex: 3, played: 5, total: 10, score: 4.5 },
      USER,
    );
    expect(prog.status).toBe(200);
    expect(tables.SoloProgress).toHaveLength(1);

    const list1 = (await (await get("/solo/sessions", USER)).json()) as {
      sessions: { id: number; resume?: { played: number } }[];
    };
    expect(list1.sessions.find((s) => s.id === 1)?.resume).toMatchObject({
      played: 5,
      total: 10,
    });

    // A second progress write updates in place.
    await post(
      "/solo/sessions/1/progress",
      { orderIndex: 2, songIndex: 4, played: 6, total: 10, score: 5.5 },
      USER,
    );
    expect(tables.SoloProgress).toHaveLength(1);
    expect(tables.SoloProgress[0].fields.played).toBe(6);

    // Final score: persisted, progress row deleted.
    const save1 = (await (
      await post("/solo/sessions/1/score", { score: 7.5 }, USER)
    ).json()) as {
      score: number;
      persisted: boolean;
    };
    expect(save1).toMatchObject({ score: 7.5, persisted: true });
    expect(tables.SoloProgress).toHaveLength(0);
    expect(tables.Scores[0].fields).toMatchObject({
      user: "oidc-user-1",
      value: 7.5,
      userName: "Fred OIDC",
    });

    // Replay never overwrites — the canonical first score comes back.
    const save2 = (await (
      await post("/solo/sessions/1/score", { score: 9 }, USER)
    ).json()) as {
      score: number;
      persisted: boolean;
    };
    expect(save2).toMatchObject({ score: 7.5, persisted: false });
    expect(tables.Scores).toHaveLength(1);

    // The listing now carries the saved score.
    const list2 = (await (await get("/solo/sessions", USER)).json()) as {
      sessions: { id: number; score?: number }[];
    };
    expect(list2.sessions.find((s) => s.id === 1)?.score).toBe(7.5);
  });

  it("guests without a subject get 403; negative scores 400", async () => {
    const buzzerGuest = cookieFor({ kind: "guest", name: "g" });
    expect(
      (await post("/solo/sessions/1/score", { score: 1 }, buzzerGuest)).status,
    ).toBe(403);
    expect(
      (await post("/solo/sessions/1/score", { score: -1 }, USER)).status,
    ).toBe(400);
  });

  it("leaderboard ranks with standard competition ties and Guests-name fallback", async () => {
    const guest = cookieFor({
      kind: "guest_online",
      sub: "aaaabbbbccccdddd",
      name: "Guesty",
    });
    tables.Guests = [
      { id: 900, fields: { subject: "aaaabbbbccccdddd", username: "Guesty" } },
    ];
    tables.Scores = [
      {
        id: 901,
        fields: { user: "u1", session: 1, value: 10, userName: "Alice" },
      },
      {
        id: 902,
        fields: { user: "u2", session: 1, value: 10, userName: "Bob" },
      },
      // Empty userName → falls back to the Guests table.
      {
        id: 903,
        fields: {
          user: "aaaabbbbccccdddd",
          session: 1,
          value: 8,
          userName: "",
        },
      },
      {
        id: 904,
        fields: { user: "u4", session: 2, value: 99, userName: "OtherSession" },
      },
    ];
    const lb = (await (
      await get("/solo/sessions/1/leaderboard", guest)
    ).json()) as {
      entries: {
        rank: number;
        userName: string;
        score: number;
        isMe?: boolean;
      }[];
    };
    expect(lb.entries).toEqual([
      { rank: 1, userName: "Alice", score: 10 },
      { rank: 1, userName: "Bob", score: 10 },
      { rank: 3, userName: "Guesty", score: 8, isMe: true },
    ]);
  });
});
