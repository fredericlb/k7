import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLayout } from "@studio/mediatek/layout";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeComments } from "../shares/comments.ts";
import { blobDir, isKey, keyOf } from "../shares/store.ts";
import { publicShareRouter } from "./publicShare.ts";
import { sharesRouter } from "./shares.ts";

// Both halves mounted as `../mount.ts` mounts them, fence included — see ../../../docs/media/shares.md.
let root: string;
let server: Server;
let base: string;
let who = "alice";

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "shares-http-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use("/api/public/share", publicShareRouter());
  app.use(
    "/api/shares",
    (req, _res, next) => {
      (req as { user?: unknown }).user = { sub: who, email: `${who}@x.test` };
      next();
    },
    sharesRouter(),
  );
  // The fence, in its real position: everything below it needs a session.
  app.use("/api", (_req, res) =>
    res.status(401).json({ error: "unauthenticated" }),
  );
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  // The database is opened once and cached; the next test points at another directory entirely.
  closeComments();
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
  who = "alice";
});

const MANIFEST = {
  schema: 1,
  name: "Danse",
  mode: "arrangement",
  media: {
    mix: { file: "audio/mix.wav", bytes: 0 },
    stems: [
      { id: "s0", track: "t1", name: "Basse", file: "audio/s0.mp3", bytes: 0 },
    ],
    video: false,
  },
  docs: ["project-doc.json"],
  bytes: 0,
};

/** `res.json()` answers `unknown` here; every call below knows the shape it asked for. */
const body = async <T>(r: Response): Promise<T> => (await r.json()) as T;

interface Draft {
  key: string;
  token: string;
  expects: string[];
}

/** Open a draft with the manifest a real upload would have just built. */
const draftOne = (): Promise<Draft> =>
  fetch(`${base}/api/shares`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      manifest: MANIFEST,
      origin: { repo: "band", project: "danse.st0" },
    }),
  }).then(body<Draft>);

/** Upload one whole share and return its secret — the three steps a real upload takes. */
async function share(): Promise<{ token: string; key: string }> {
  const draft = await draftOne();
  for (const path of draft.expects)
    await fetch(
      `${base}/api/shares/${draft.key}/file?path=${encodeURIComponent(path)}`,
      { method: "PUT", body: `bytes of ${path}` },
    );
  await fetch(`${base}/api/shares/${draft.key}/finish`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: draft.token }),
  });
  return { token: draft.token, key: draft.key };
}

describe("uploading one", () => {
  it("mints a key that is the hash of the token, never the token", async () => {
    const { token, key } = await share();
    expect(key).toBe(keyOf(token));
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    // The secret must not be derivable from the thing that IS a path segment.
    expect(key).not.toContain(token);
  });

  it("is not readable until it is finished", async () => {
    const draft = await draftOne();
    // `pending.json` is there, so the link is a 404 — a crashed upload is never half-live.
    expect(
      (await fetch(`${base}/api/public/share/${draft.key}/manifest`)).status,
    ).toBe(404);
  });

  it("refuses a file the draft never promised", async () => {
    const draft = await draftOne();
    const r = await fetch(
      `${base}/api/shares/${draft.key}/file?path=${encodeURIComponent("../../escape.wav")}`,
      { method: "PUT", body: "x" },
    );
    expect(r.status).toBe(400);
  });

  it("refuses a manifest naming a file outside the share's own folder", async () => {
    for (const bad of [
      { docs: ["../index/alice.json"] },
      { docs: ["pending.json"] },
      { media: { ...MANIFEST.media, mix: { file: "audio/../../x.wav" } } },
      { media: { ...MANIFEST.media, mix: { file: "mix.wav" } } },
    ]) {
      const r = await fetch(`${base}/api/shares`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ manifest: { ...MANIFEST, ...bad } }),
      });
      expect(r.status).toBe(400);
    }
  });

  it("leaves no temporary upload behind", async () => {
    await share();
    expect(readdirSync(join(root, ".shares", "uploads"))).toEqual([]);
  });

  it("refuses to finish when something never arrived", async () => {
    const draft = await draftOne();
    const r = await fetch(`${base}/api/shares/${draft.key}/finish`, {
      method: "POST",
    });
    expect(r.status).toBe(400);
    expect((await body<{ error: string }>(r)).error).toMatch(/never arrived/);
  });

  it("measures the sizes itself rather than believing the draft", async () => {
    const { key } = await share();
    const snap = JSON.parse(
      readFileSync(join(blobDir(key), "snapshot.json"), "utf8"),
    ) as { media: { mix: { bytes: number } } };
    expect(snap.media.mix.bytes).toBe("bytes of audio/mix.wav".length);
  });
});

/** NO credential of any kind: an `<audio>` element sends none, so a share needing one cannot play. */
describe("reading one with no session at all", () => {
  it("answers the manifest", async () => {
    const { key } = await share();
    const r = await fetch(`${base}/api/public/share/${key}/manifest`);
    expect(r.status).toBe(200);
    expect((await body<{ name: string }>(r)).name).toBe("Danse");
  });

  it("answers the audio, and says it can be seeked in", async () => {
    const { key } = await share();
    const r = await fetch(`${base}/api/public/share/${key}/audio/s0.mp3`);
    expect(r.status).toBe(200);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
  });

  it("answers a document the snapshot lists", async () => {
    const { key } = await share();
    expect(
      (await fetch(`${base}/api/public/share/${key}/doc/project-doc.json`))
        .status,
    ).toBe(200);
  });

  it("keeps it out of search results", async () => {
    const { key } = await share();
    const r = await fetch(`${base}/api/public/share/${key}/manifest`);
    expect(r.headers.get("x-robots-tag")).toMatch(/noindex/);
  });
});

describe("what the public half refuses", () => {
  it("a key that is not a key, before it can reach a path", async () => {
    for (const bad of ["..%2F..%2Fetc%2Fpasswd", "not-hex", "a".repeat(63)]) {
      const r = await fetch(`${base}/api/public/share/${bad}/manifest`);
      expect(r.status, `key '${bad}'`).toBe(404);
    }
  });

  /** The bare `..` cases are HERE and not over HTTP: `fetch` resolves them, ../../../docs/media/shares.md. */
  it("is a hex sha256 and nothing else — the guard itself", () => {
    for (const bad of [
      "..",
      "../..",
      "../../etc/passwd",
      "",
      "not-hex",
      "A".repeat(64),
      "a".repeat(63),
      `${"a".repeat(64)}/x`,
    ])
      expect(isKey(bad), `key '${bad}'`).toBe(false);
    expect(isKey("a".repeat(64))).toBe(true);
  });

  it("a file the manifest does not list, even when it is really there", async () => {
    const { key } = await share();
    writeFileSync(join(blobDir(key), "audio", "secret.wav"), "x", "utf8");
    expect(
      (await fetch(`${base}/api/public/share/${key}/audio/secret.wav`)).status,
    ).toBe(404);
  });

  it("a document the manifest does not list", async () => {
    const { key } = await share();
    writeFileSync(join(blobDir(key), "pending-ish.json"), "{}", "utf8");
    expect(
      (await fetch(`${base}/api/public/share/${key}/doc/pending-ish.json`))
        .status,
    ).toBe(404);
  });

  /** The one that catches a reordered mount: this router's 404 and never the fence's 401. */
  it("answers 404 for a path it does not have — never 401", async () => {
    const { key } = await share();
    expect((await fetch(`${base}/api/public/share/${key}/nope`)).status).toBe(
      404,
    );
  });
});

describe("taking one back", () => {
  it("deletes the bytes and kills the link", async () => {
    const { key } = await share();
    expect(
      (await fetch(`${base}/api/shares/${key}`, { method: "DELETE" })).status,
    ).toBe(200);
    expect(
      (await fetch(`${base}/api/public/share/${key}/manifest`)).status,
    ).toBe(404);
  });

  it("keeps the row, dated, and blanks the secret so it cannot be copied again", async () => {
    const { key } = await share();
    await fetch(`${base}/api/shares/${key}`, { method: "DELETE" });
    const { shares } = await body<{
      shares: { revokedAt?: string; token: string }[];
    }>(await fetch(`${base}/api/shares`));
    expect(shares).toHaveLength(1);
    expect(shares[0].revokedAt).toBeTruthy();
    expect(shares[0].token).toBe("");
  });

  it("is idempotent — a second click is not an error", async () => {
    const { key } = await share();
    await fetch(`${base}/api/shares/${key}`, { method: "DELETE" });
    expect(
      (await fetch(`${base}/api/shares/${key}`, { method: "DELETE" })).status,
    ).toBe(200);
  });

  it("refuses somebody else's, by not finding it", async () => {
    const { key } = await share();
    who = "bob";
    expect(
      (await fetch(`${base}/api/shares/${key}`, { method: "DELETE" })).status,
    ).toBe(404);
    // …and alice's link still works, which is the half that would be missed.
    expect(
      (await fetch(`${base}/api/public/share/${key}/manifest`)).status,
    ).toBe(200);
  });

  it("lists only your own", async () => {
    await share();
    who = "bob";
    const { shares } = await body<{ shares: unknown[] }>(
      await fetch(`${base}/api/shares`),
    );
    expect(shares).toEqual([]);
  });
});

/** The one write a public route takes, and the three states only its author can move it between. */
describe("commenting on one", () => {
  const write = (key: string, c: Record<string, unknown>) =>
    fetch(`${base}/api/public/share/${key}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    });

  const read = (key: string) =>
    fetch(`${base}/api/public/share/${key}/comments`).then(
      body<{ comments: { id: number; at: number | null; state: string }[] }>,
    );

  it("takes one with no credential at all, and reads it back", async () => {
    const { key } = await share();
    expect((await write(key, { author: "Zoé", body: "la basse" })).status).toBe(
      200,
    );
    const { comments } = await read(key);
    expect(comments).toHaveLength(1);
    expect(comments[0].state).toBe("active");
  });

  it("keeps the timecode when there is one, and null when there is not", async () => {
    const { key } = await share();
    await write(key, { body: "ici", at: 12.5 });
    await write(key, { body: "en général" });
    const { comments } = await read(key);
    expect(comments.map((c) => c.at)).toEqual([12.5, null]);
  });

  it("refuses an empty one", async () => {
    const { key } = await share();
    expect((await write(key, { body: "   " })).status).toBe(400);
  });

  it("refuses one on a share that does not exist, without saying whether it did", async () => {
    expect((await write("f".repeat(64), { body: "hé" })).status).toBe(404);
    expect((await write("nope", { body: "hé" })).status).toBe(404);
  });

  it("goes quiet with the bytes: a revoked link answers nothing, comments included", async () => {
    const { key } = await share();
    await write(key, { body: "avant" });
    await fetch(`${base}/api/shares/${key}`, { method: "DELETE" });
    expect(
      (await fetch(`${base}/api/public/share/${key}/comments`)).status,
    ).toBe(404);
    // …but the AUTHOR still has them: the bytes were the cost, the feedback is what it bought.
    const { comments } = await body<{ comments: unknown[] }>(
      await fetch(`${base}/api/shares/${key}/comments`),
    );
    expect(comments).toHaveLength(1);
  });

  it("counts the three states on the row, without storing them on it", async () => {
    const { key } = await share();
    await write(key, { body: "un" });
    await write(key, { body: "deux" });
    const { comments } = await read(key);
    await fetch(`${base}/api/shares/${key}/comments/${comments[0].id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state: "resolved" }),
    });
    const { shares } = await body<{
      shares: { comments: { active: number; resolved: number } }[];
    }>(await fetch(`${base}/api/shares`));
    expect(shares[0].comments).toEqual({
      active: 1,
      resolved: 1,
      ignored: 0,
    });
    // The row on DISK never learned any of it — the count is made on the way out.
    const dir = join(root, ".shares", "index");
    const filed = readdirSync(dir).map((f) =>
      readFileSync(join(dir, f), "utf8"),
    );
    expect(filed.join("")).not.toContain("comments");
  });

  it("refuses a state that is not one of the three", async () => {
    const { key } = await share();
    await write(key, { body: "un" });
    const { comments } = await read(key);
    const r = await fetch(
      `${base}/api/shares/${key}/comments/${comments[0].id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "deleted" }),
      },
    );
    expect(r.status).toBe(400);
  });

  it("lets nobody else resolve them", async () => {
    const { key } = await share();
    await write(key, { body: "un" });
    const { comments } = await read(key);
    who = "bob";
    const r = await fetch(
      `${base}/api/shares/${key}/comments/${comments[0].id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: "ignored" }),
      },
    );
    expect(r.status).toBe(404);
  });

  it("moves the revision token, so the author's poll notices", async () => {
    const { key } = await share();
    const before = await body<{ revision: string }>(
      await fetch(`${base}/api/shares/revision`),
    );
    await write(key, { body: "un" });
    const after = await body<{ revision: string }>(
      await fetch(`${base}/api/shares/revision`),
    );
    expect(after.revision).not.toBe(before.revision);
  });
});
