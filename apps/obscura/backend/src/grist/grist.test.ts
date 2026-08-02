import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GristClient, type GristRecord, gristIdList } from "./client.ts";
import { listGristSessions, loadSessionFromGrist } from "./load.ts";
import { ensureGristSchema } from "./schema.ts";

// A stub Grist instance: serves fixture rows from the records API (honouring
// the {"id":[…]} filter), answers /tables and /columns for the schema
// bootstrap, and records every /apply payload for assertions.

const fixtures: Record<string, GristRecord[]> = {
  Sessions: [
    {
      id: 1,
      fields: {
        name: "Test Night",
        guestPassword: "swordfish",
        order: ["L", 10, 11],
      },
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
        notice: "hint",
        illustration: "rock.png",
        trackType: "",
        liveOnly: false,
        songs: ["L", 30, 31],
      },
    },
  ],
  Songs: [
    {
      id: 30,
      fields: {
        label: "",
        answer: "piaf",
        liveOnly: false,
        fx_speed: 2,
        tracks: ["L", 40],
      },
    },
    { id: 31, fields: { label: "duo", liveOnly: true, tracks: ["L", 41] } },
  ],
  Tracks: [
    // No audio attachments — keeps the loader off the ffmpeg path.
    {
      id: 40,
      fields: {
        artist: "Édith Piaf",
        title: "La Vie en rose",
        type: "",
        start: 0,
        end: 0,
      },
    },
    {
      id: 41,
      fields: { artist: "A", title: "B", type: "", start: 5, end: 25 },
    },
  ],
};

let server: Server;
let base: string;
const applied: unknown[][] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (v: unknown) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(v));
    };
    const m = url.pathname.match(/^\/api\/docs\/DOC\/tables\/(\w+)\/records$/);
    if (m) {
      let rows = fixtures[m[1]] ?? [];
      const rawFilter = url.searchParams.get("filter");
      if (rawFilter) {
        const filter = JSON.parse(rawFilter) as Record<string, unknown[]>;
        for (const [col, vals] of Object.entries(filter)) {
          rows = rows.filter((r) =>
            (vals as unknown[]).includes(col === "id" ? r.id : r.fields[col]),
          );
        }
      }
      send({ records: rows });
      return;
    }
    if (url.pathname === "/api/docs/DOC/tables") {
      send({ tables: [{ id: "Sessions" }, { id: "tracks" }] }); // note lower-case "tracks"
      return;
    }
    const cm = url.pathname.match(/^\/api\/docs\/DOC\/tables\/(\w+)\/columns$/);
    if (cm) {
      // "tracks" exists but is missing youtubeId; Sessions is complete.
      if (cm[1].toLowerCase() === "tracks") {
        send({
          columns: [
            { id: "artist" },
            { id: "title" },
            { id: "audio" },
            { id: "type" },
            { id: "start" },
            { id: "end" },
          ],
        });
      } else {
        send({
          columns: [
            { id: "name" },
            { id: "guestPassword" },
            { id: "urlToken" },
            { id: "order" },
          ],
        });
      }
      return;
    }
    if (url.pathname === "/api/docs/DOC/apply") {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        applied.push(...(JSON.parse(body) as unknown[][]));
        send(null);
      });
      return;
    }
    if (url.pathname === "/api/docs/DOC/sql") {
      send({ records: [] });
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(() => server.close());

const client = () => new GristClient({ url: base, apiKey: "k", docId: "DOC" });

describe("GristClient", () => {
  it("lists records with an id filter", async () => {
    const rows = await client().listRecords("Songs", { id: [31] });
    expect(rows.map((r) => r.id)).toEqual([31]);
  });

  it("encodes RefLists with the L sentinel", () => {
    expect(gristIdList(1, 2)).toEqual(["L", 1, 2]);
  });
});

describe("listGristSessions", () => {
  it("returns picker rows sorted by id", async () => {
    const sessions = await listGristSessions(client());
    expect(sessions).toEqual([
      { id: 1, name: "Test Night", guestPassword: "swordfish" },
    ]);
  });
});

describe("loadSessionFromGrist", () => {
  it("walks order → categories → songs → tracks and collapses single tracks", async () => {
    const s = await loadSessionFromGrist(client(), 1);
    expect(s.guestPassword).toBe("swordfish");
    expect(s.categories).toHaveLength(1);

    const cat = s.categories[0];
    expect(cat.name).toBe("Rock");
    expect(cat.songs).toHaveLength(2);

    // Single-track songs collapse the track into the Song's own fields.
    const song0 = cat.songs[0];
    expect(song0.artist).toBe("Édith Piaf");
    expect(song0.title).toBe("La Vie en rose");
    expect(song0.answer).toBe("piaf");
    expect(song0.effects).toEqual({ speed: 2 });
    expect(cat.songs[1].liveOnly).toBe(true);

    // Order: zero start/end are treated as unset; the pause entry survives.
    expect(s.order).toEqual([{ cat: "Rock" }, { type: "pause" }]);
  });

  it("rejects a session with no order entries", async () => {
    fixtures.Sessions.push({ id: 2, fields: { name: "Empty", order: ["L"] } });
    await expect(loadSessionFromGrist(client(), 2)).rejects.toThrow(
      /no order entries/,
    );
  });
});

describe("ensureGristSchema", () => {
  it("creates missing tables and reconciles missing columns case-insensitively", async () => {
    applied.length = 0;
    await ensureGristSchema(client());

    const addTables = applied
      .filter((a) => a[0] === "AddTable")
      .map((a) => a[1]);
    // Sessions + tracks exist (tracks only case-differs) — everything else is created.
    expect(addTables).not.toContain("Sessions");
    expect(addTables).not.toContain("Tracks");
    expect(addTables).toEqual(
      expect.arrayContaining([
        "Songs",
        "Categories",
        "OrderEntries",
        "Scores",
        "Games",
      ]),
    );

    // The existing lower-case "tracks" table gets its missing youtubeId column,
    // addressed by its stored casing.
    const addCols = applied.filter((a) => a[0] === "AddVisibleColumn");
    expect(addCols).toContainEqual([
      "AddVisibleColumn",
      "tracks",
      "youtubeId",
      { type: "Text", isFormula: false },
    ]);
  });
});
