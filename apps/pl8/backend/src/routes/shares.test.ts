import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLayout } from "@studio/mediatek/layout";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { blobDir, isKey, keyOf } from "../shares/store.ts";
import { publicShareRouter } from "./publicShare.ts";
import { sharesRouter } from "./shares.ts";

// Both halves mounted as `server.ts` mounts them, fence included — see ../../docs/shares.md.
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

  /** The bare `..` cases are HERE and not over HTTP: `fetch` resolves them, ../../docs/shares.md. */
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
