import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MomentPlacement } from "@studio/rehearsal-shared";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The store is opened at import, so the environment is set before anything of it loads.
const dir = mkdtempSync(join(tmpdir(), "k7-moments-"));
process.env.K7_DATA_DIR = dir;
const db = await import("./db.ts");
const { linkMediatek } = await import("./mediatek.ts");
const { momentDeviceRouter } = await import("./momentShare.ts");
const { momentShareRouter } = await import("./momentConsolidate.ts");
const { wavHeader } = await import("./wavSlice.ts");
const { momentsRouter } = await import("./routes/moments.ts");

const servers: Server[] = [];
const listen = (app: express.Express): Promise<string> =>
  new Promise((ok) => {
    const s = app.listen(0, () =>
      ok(`http://127.0.0.1:${(s.address() as { port: number }).port}`),
    );
    servers.push(s);
  });

// A médiathèque that files a recording under a fresh path, remembers what was removed, and serves a clip.
const pushed: string[] = [];
const removed: string[] = [];
let local: string;
let received: {
  id: string;
  moment: unknown;
  field: string;
  bytes: string;
  token: string;
} | null = null;

beforeAll(async () => {
  const lib = express();
  lib.post("/api/mediatek/recording", (_req, res) => {
    const path = `recordings/2026/clip-${pushed.length}.webm`;
    pushed.push(path);
    res.json({ path, day: "2026", name: path });
  });
  lib.delete("/api/mediatek/file", (req, res) => {
    removed.push(String(req.query.path));
    res.json({ ok: true });
  });
  lib.get("/api/mediatek/file", (_req, res) => res.send("clip bytes"));
  linkMediatek({ base: await listen(lib) });

  // The server the machine shares to, recording what arrived.
  const srv = express();
  srv.get("/dev", (_req, res) => res.json(["m-shared"]));
  srv.put(
    "/dev/:id",
    express.raw({ type: "*/*", limit: "5mb" }),
    (req, res) => {
      const body = (req.body as Buffer).toString("latin1");
      const moment = /name="moment"\r\n\r\n(.*?)\r\n--/s.exec(body)?.[1];
      const file =
        /name="(source|clip)"; filename="[^"]*"\r\n[^\r]*\r\n\r\n(.*?)\r\n--/s.exec(
          body,
        );
      received = {
        id: req.params.id,
        moment: JSON.parse(moment ?? "null"),
        field: file?.[1] ?? "",
        bytes: file?.[2] ?? "",
        token: String(req.headers.authorization),
      };
      if (req.params.id === "m-refused")
        return void res.status(400).json({ error: "bad moment" });
      res.json({ ok: true, replaced: false });
    },
  );
  const server = await listen(srv);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as { user?: { sub: string } }).user = { sub: "me" };
    next();
  });
  // The gate as deviceGate leaves it: the person a device's token names, here from a header.
  app.use(
    "/dev",
    momentDeviceRouter((req, res, next) => {
      res.locals.syncCaller = {
        slug: "a",
        person: req.headers["x-person"] ?? null,
        device: "laptop",
      };
      next();
    }),
  );
  app.use("/moments", momentsRouter);
  app.use(
    "/share",
    momentShareRouter({
      deviceRoute: "/dev",
      server: () => ({ base: server, token: "t" }),
      serverOnly: true,
      active: () => ({
        id: "active",
        origin: "http://active.test",
        as: "p@active",
        base: server,
        token: "t-active",
      }),
      reach: async (s) => s.token === "t-active",
    }),
  );
  local = await listen(app);

  await db.addRecords("Comments", [
    {
      id: "m-shared",
      OwnerId: "me",
      RecordingPath: "recordings/2026-10-01/22-00-00.webm",
      StartSec: 10,
      EndSec: 15,
      Text: "chorus",
      Validated: true,
      ClipPath: "recordings/old.webm",
    },
    {
      id: "m-refused",
      OwnerId: "me",
      RecordingPath: "recordings/2026-10-01/22-00-00.webm",
      StartSec: 1,
      EndSec: 2,
    },
    {
      id: "m-local",
      OwnerId: "me",
      RecordingPath: "recordings/2026-10-01/22-00-00.webm",
      RecordedAt: "2026-10-01T20:00:00.000Z",
      StartSec: 20,
      EndSec: 30,
      Text: "bridge",
      Tags: "loud,fast",
      Validated: true,
      ClipPath: "recordings/bridge.webm",
    },
  ]);
  await db.addRecords("Sessions", [
    {
      Uid: "s1",
      OwnerId: "me",
      CreatedAt: "2026-10-01T20:00:00.000Z",
      RecordingPath: "recordings/2026-10-01/22-00-00.webm",
    },
  ]);
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((ok) => s.close(ok))));
  db.store.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = (id: string, person: string | null, moment: unknown) => {
  const form = new FormData();
  form.append("moment", JSON.stringify(moment));
  form.append("clip", new Blob(["webm"]), "moment.webm");
  return fetch(`${local}/dev/${id}`, {
    method: "PUT",
    headers: person ? { "x-person": person } : {},
    body: form,
  });
};

const MOMENT = {
  startSec: 1,
  endSec: 4,
  text: "intro",
  tags: ["soft"],
  createdAt: "2026-10-01T20:05:00.000Z",
  sessionCreatedAt: "2026-10-01T20:00:00.000Z",
  envelope: null,
  markers: [{ atSec: 2, comment: "here", createdAt: "x" }],
};

describe("the server's door for shared moments", () => {
  it("takes a moment from a person, with its clip and markers, under the machine's id", async () => {
    expect((await put("m-new", "p1", MOMENT)).status).toBe(200);
    const [rec] = (await db.listRecords("Comments")).filter(
      (r) => r.id === "m-new",
    );
    expect(rec.fields).toMatchObject({
      OwnerId: "p1",
      // A machine older than `recordedAt` sends the session's date, which dates the moment all the same.
      RecordingPath: "",
      RecordedAt: MOMENT.sessionCreatedAt,
      Validated: true,
      Tags: "soft",
    });
    const markers = await db.listRecords("Markers", { MomentId: ["m-new"] });
    expect(markers.map((m) => m.fields.Comment)).toEqual(["here"]);
    const ids = await (
      await fetch(`${local}/dev`, { headers: { "x-person": "p1" } })
    ).json();
    expect(ids).toContain("m-new");
  });

  it("replaces on a second share: the old clip and markers go", async () => {
    const before = pushed.at(-1);
    expect(
      (await put("m-new", "p1", { ...MOMENT, text: "intro 2", markers: [] }))
        .status,
    ).toBe(200);
    expect(removed).toContain(before);
    expect(await db.listRecords("Markers", { MomentId: ["m-new"] })).toEqual(
      [],
    );
  });

  it("refuses a token that names nobody, and another person's moment", async () => {
    expect((await put("m-x", null, MOMENT)).status).toBe(403);
    expect((await put("m-new", "p2", MOMENT)).status).toBe(409);
  });

  it("refuses an id that is not one plain segment, and malformed JSON", async () => {
    expect((await put("m.x", "p1", MOMENT)).status).toBe(400);
    expect((await put("..%2Fescape", "p1", MOMENT)).status).toBe(400);
    const form = new FormData();
    form.append("moment", "{not json");
    form.append("clip", new Blob(["webm"]), "moment.webm");
    const res = await fetch(`${local}/dev/m-bad`, {
      method: "PUT",
      headers: { "x-person": "p1" },
      body: form,
    });
    expect(res.status).toBe(400);
  });
});

describe("a shared moment on the server", () => {
  it("says where it came from, and is read and deleted but never edited", async () => {
    // Shared by the person this test signs in as, so the moments routes see it as theirs.
    expect((await put("m-ro", "me", MOMENT)).status).toBe(200);
    const moment = (await (await fetch(`${local}/moments/m-ro`)).json()) as {
      markers: { id: string }[];
    };
    expect(moment).toMatchObject({ sharedFrom: "laptop", text: "intro" });
    const [marker] = moment.markers;
    const edit = await fetch(`${local}/moments/m-ro/markers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atSec: 1 }),
    });
    expect(edit.status).toBe(403);
    expect(
      (
        await fetch(`${local}/moments/m-ro/markers/${marker.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${local}/moments/m-ro`, { method: "DELETE" })).status,
    ).toBe(204);
  });

  it("leaves a moment of the server's own editable", async () => {
    const r = await fetch(`${local}/moments/m-local/markers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atSec: 1 }),
    });
    expect(r.status).toBe(201);
  });
});

describe("sharing from this machine", () => {
  it("says which moments the server holds", async () => {
    const p = (await (await fetch(`${local}/share`)).json()) as MomentPlacement;
    expect(p.shared).toEqual(["m-shared"]);
  });

  it("names the account's active server and whether it answers", async () => {
    const got = await (await fetch(`${local}/share/servers`)).json();
    expect(got).toMatchObject({
      serverOnly: true,
      server: { id: "active", as: "p@active", online: true },
    });
  });

  const consolidate = (id: string, link: string) =>
    fetch(`${local}/share/${id}/consolidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ link }),
    });

  it("sends the moment and its recording's audio to the active server, and remembers where", async () => {
    const r = await consolidate("m-local", "active");
    expect(r.status).toBe(200);
    expect(received).toMatchObject({
      id: "m-local",
      token: "Bearer t-active",
      // The recording is no WAV, so it goes whole, from its start.
      field: "source",
      bytes: "clip bytes",
      moment: {
        startSec: 20,
        text: "bridge",
        tags: ["loud", "fast"],
        recordedAt: "2026-10-01T20:00:00.000Z",
        sourceStartSec: 0,
      },
    });
    const moment = (await (await fetch(`${local}/moments/m-local`)).json()) as {
      consolidations: unknown;
    };
    expect(moment.consolidations).toMatchObject([
      { link: "active", origin: "http://active.test", as: "p@active" },
    ]);
  });

  it("refuses a server that is not the active one, and says what the server refused", async () => {
    expect((await consolidate("m-local", "nope")).status).toBe(404);
    const r = await consolidate("m-refused", "active");
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toContain(
      "bad moment",
    );
  });
});

describe("a moment consolidated on the server from a machine's audio", () => {
  it("is cut here out of the slice it was sent, at the slice's offset", async () => {
    const rate = 8000;
    const frames = rate * 2;
    const data = Buffer.alloc(frames * 2);
    for (let f = 0; f < frames; f++)
      data.writeInt16LE(Math.round(3000 * Math.sin(f / 4)), f * 2);
    const fmt = Buffer.alloc(16);
    fmt.writeUInt16LE(1, 0);
    fmt.writeUInt16LE(1, 2);
    fmt.writeUInt32LE(rate, 4);
    fmt.writeUInt32LE(rate * 2, 8);
    fmt.writeUInt16LE(2, 12);
    fmt.writeUInt16LE(16, 14);
    const form = new FormData();
    form.append(
      "moment",
      JSON.stringify({
        ...MOMENT,
        startSec: 11,
        endSec: 12,
        sourceStartSec: 10,
      }),
    );
    form.append(
      "source",
      new Blob([Buffer.concat([wavHeader(fmt, data.length), data])]),
      "moment.wav",
    );
    const before = pushed.length;
    const res = await fetch(`${local}/dev/m-cut`, {
      method: "PUT",
      headers: { "x-person": "p1" },
      body: form,
    });
    expect(res.status).toBe(200);
    expect(pushed.length).toBe(before + 1);
    const [rec] = (await db.listRecords("Comments")).filter(
      (r) => r.id === "m-cut",
    );
    expect(rec.fields).toMatchObject({
      OwnerId: "p1",
      Validated: true,
      StartSec: 11,
      RecordingPath: "",
    });
  }, 30_000);
});
