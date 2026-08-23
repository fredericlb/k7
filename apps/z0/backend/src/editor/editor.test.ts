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

// Editor flows against a stub Grist: the id-preserving load, the save reconciler, duplication.

const SECRET = "editor-test-secret-0123456789abcdef";

// Set first, then minted from the RESOLVED config, so a local env.yaml cannot disagree with us.
process.env.SESSION_SECRET = SECRET;
process.env.AUTH_ADMIN_GROUPS = "blindtest-admins";
const authConfig = loadAppConfig().auth;

const ADMIN = sessionCookieHeader(
  { kind: "user", sub: "admin", groups: authConfig.adminGroups },
  { cookieName: SESSION_COOKIE_NAME, secret: authConfig.sessionSecret },
);

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
        for (const action of JSON.parse(body) as unknown[][]) {
          if (action[0] === "BulkRemoveRecord") {
            const t = tables[String(action[1])] ?? [];
            const ids = action[2] as number[];
            tables[String(action[1])] = t.filter((r) => !ids.includes(r.id));
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
  gameState.gristClient = new GristClient({
    url: `http://127.0.0.1:${typeof gAddr === "object" && gAddr ? gAddr.port : 0}`,
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
  app.use(express.json({ limit: "32mb" }));
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
        fields: { name: "Editable", guestPassword: "pw", order: ["L", 10, 11] },
      },
    ],
    OrderEntries: [
      { id: 10, fields: { type: "cat", category: 20, start: 0, end: 0 } },
      { id: 11, fields: { type: "pause", category: 0, start: 0, end: 0 } },
    ],
    Categories: [
      {
        id: 20,
        fields: {
          name: "Rock",
          mode: "",
          notice: "",
          illustration: "",
          trackType: "",
          liveOnly: false,
          songs: ["L", 30],
        },
      },
    ],
    Songs: [
      {
        id: 30,
        fields: {
          label: "",
          status: "valid",
          answer: "",
          liveOnly: false,
          code: "",
          fx_speed: 2,
          tracks: ["L", 40],
        },
      },
    ],
    Tracks: [
      {
        id: 40,
        fields: {
          artist: "A",
          title: "T",
          type: "",
          start: 1,
          end: 2,
          youtubeId: "",
          audio: ["L", 99],
        },
      },
    ],
  };
  nextId = 100;
});

const get = (path: string) =>
  fetch(base + path, { headers: { Cookie: ADMIN } });
const post = (path: string, body: unknown) =>
  fetch(base + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: ADMIN },
    body: JSON.stringify(body),
  });

describe("editor load", () => {
  it("returns the id-preserving subtree", async () => {
    const s = (await (await get("/editor/sessions/1")).json()) as Record<
      string,
      unknown
    >;
    expect(s).toMatchObject({ id: 1, name: "Editable", guestPassword: "pw" });
    expect(s.order).toEqual([
      { id: 10, type: "cat", categoryId: 20, start: 0, end: 0 },
      { id: 11, type: "pause", start: 0, end: 0 },
    ]);
    expect(
      (s.categories as { id: number; songIds: number[] }[])[0],
    ).toMatchObject({
      id: 20,
      songIds: [30],
    });
    expect(
      (s.songs as { effects?: unknown; firstArtist?: string }[])[0],
    ).toMatchObject({
      effects: { speed: 2 },
      firstArtist: "A",
    });
    expect(
      (s.tracks as { hasAudio: boolean; audioRowId?: number }[])[0],
    ).toMatchObject({
      hasAudio: true,
      audioRowId: 99,
    });
  });

  it("serves the songs library with first-track previews", async () => {
    const lib = (await (await get("/editor/library/songs")).json()) as {
      songs: { id: number; firstTitle?: string }[];
    };
    expect(lib.songs[0]).toMatchObject({ id: 30, firstTitle: "T" });
    expect((await get("/editor/library/nope")).status).toBe(400);
  });
});

describe("editor save reconciler", () => {
  it("creates temp-id rows bottom-up, updates existing ones, deletes stale order", async () => {
    // A new track on the old song, a whole new category, a rename, and the pause dropped.
    const save = await post("/editor/sessions/1", {
      name: "Renamed",
      guestPassword: "pw2",
      order: [
        { id: "10", type: "cat", categoryId: "20" },
        { id: "new-order-1", type: "cat", categoryId: "new-cat-1", start: 1 },
      ],
      categories: [
        {
          id: "20",
          name: "Rock",
          mode: "",
          notice: "",
          illustration: "",
          trackType: "",
          liveOnly: false,
          songIds: ["30"],
        },
        {
          id: "new-cat-1",
          name: "Fresh",
          mode: "free",
          notice: "",
          illustration: "",
          trackType: "",
          liveOnly: false,
          songIds: ["new-song-1"],
        },
      ],
      songs: [
        {
          id: "30",
          label: "",
          status: "valid",
          answer: "",
          liveOnly: false,
          effects: { speed: 3 },
          code: "",
          trackIds: ["40", "new-track-1"],
        },
        {
          id: "new-song-1",
          label: "",
          status: "",
          answer: "fresh",
          liveOnly: false,
          code: "",
          trackIds: ["new-track-2"],
        },
      ],
      tracks: [
        {
          id: "40",
          artist: "A",
          title: "T",
          type: "",
          start: 1,
          end: 2,
          youtubeId: "",
          audioRowId: 99,
        },
        {
          id: "new-track-1",
          artist: "B",
          title: "U",
          type: "stems",
          start: 0,
          end: 0,
          youtubeId: "",
        },
        {
          id: "new-track-2",
          artist: "C",
          title: "V",
          type: "",
          start: 5,
          end: 9,
          youtubeId: "",
        },
      ],
    });
    expect(save.status).toBe(200);
    const result = (await save.json()) as {
      ok: boolean;
      idMap: Record<string, number>;
      orphanCount: number;
    };
    expect(result.ok).toBe(true);
    expect(Object.keys(result.idMap).sort()).toEqual([
      "new-cat-1",
      "new-order-1",
      "new-song-1",
      "new-track-1",
      "new-track-2",
    ]);
    expect(result.orphanCount).toBe(1); // the dropped pause entry

    // The stale pause OrderEntry is deleted.
    expect(tables.OrderEntries.find((r) => r.id === 11)).toBeUndefined();

    // Session row updated with the new order (existing 10 + created entry).
    const session = tables.Sessions[0];
    expect(session.fields.name).toBe("Renamed");
    const order = session.fields.order as unknown[];
    expect(order[0]).toBe("L");
    expect(order[1]).toBe(10);
    expect(order[2]).toBe(result.idMap["new-order-1"]);

    // The old song's RefList carries the resolved new track, and fx_speed went 2 → 3.
    const song30 = tables.Songs.find((r) => r.id === 30)!;
    expect(song30.fields.tracks).toEqual([
      "L",
      40,
      result.idMap["new-track-1"],
    ]);
    expect(song30.fields.fx_speed).toBe(3);

    // The new category points at the new song, which points at the new track.
    const newCat = tables.Categories.find(
      (r) => r.id === result.idMap["new-cat-1"],
    )!;
    expect(newCat.fields.songs).toEqual(["L", result.idMap["new-song-1"]]);

    // The new OrderEntry got its category resolved and start stamped.
    const newOrder = tables.OrderEntries.find(
      (r) => r.id === result.idMap["new-order-1"],
    )!;
    expect(newOrder.fields).toMatchObject({
      type: "cat",
      category: result.idMap["new-cat-1"],
      start: 1,
    });
  });

  it("rejects a reference to an undefined temp id", async () => {
    const save = await post("/editor/sessions/1", {
      name: "X",
      guestPassword: "",
      order: [{ id: "10", type: "cat", categoryId: "20" }],
      categories: [
        {
          id: "20",
          name: "Rock",
          mode: "",
          notice: "",
          illustration: "",
          trackType: "",
          liveOnly: false,
          songIds: ["never-defined"],
        },
      ],
      songs: [],
      tracks: [],
    });
    expect(save.status).toBe(502);
    expect(((await save.json()) as { error: string }).error).toContain(
      "never-defined",
    );
  });
});

describe("editor create + duplicate", () => {
  it("creates an empty session", async () => {
    const created = (await (
      await post("/editor/sessions", { name: "Blank" })
    ).json()) as { id: number };
    expect(created.id).toBeGreaterThan(0);
    expect(tables.Sessions.find((r) => r.id === created.id)?.fields.name).toBe(
      "Blank",
    );
  });

  it("duplicates the session structure while sharing songs", async () => {
    const dup = (await (
      await post("/editor/sessions/1/duplicate", { name: "Copy" })
    ).json()) as {
      id: number;
      clonedCategories: number;
      clonedOrderEntries: number;
    };
    expect(dup).toMatchObject({ clonedCategories: 1, clonedOrderEntries: 2 });

    const copy = tables.Sessions.find((r) => r.id === dup.id)!;
    expect(copy.fields.guestPassword).toBe("pw");
    const newOrderIds = (copy.fields.order as unknown[]).slice(1) as number[];
    expect(newOrderIds).toHaveLength(2);
    // The cloned category shares the SAME songs RefList as the original.
    const clonedCatId = tables.OrderEntries.find(
      (r) => r.id === newOrderIds[0],
    )!.fields.category as number;
    expect(clonedCatId).not.toBe(20);
    expect(
      tables.Categories.find((r) => r.id === clonedCatId)!.fields.songs,
    ).toEqual(["L", 30]);
  });
});
