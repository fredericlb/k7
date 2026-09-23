import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureLayout } from "@studio/mediatek/layout";
import { FAMILY_ERROR } from "@studio/mediatek/types";
import express from "express";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libraryRouter } from "./library.ts";

// The router alone, no auth: this covers the upload's contract, not who may call it.
let root: string;
let server: Server;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mediatek-http-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  const app = express();
  // Mounted as server.ts does, json included: a global json() ahead of raw() can eat a body.
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/mediatek", libraryRouter);
  server = await new Promise<Server>((ok) => {
    const s = app.listen(0, () => ok(s));
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterEach(async () => {
  await new Promise((ok) => server.close(ok));
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const post = (q: Record<string, string>, body: string): Promise<Response> =>
  fetch(`${base}/api/mediatek/song?${new URLSearchParams(q)}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body,
  });

const tags = {
  filename: "whatever.mp3",
  artist: "Miles Davis",
  album: "Kind of Blue",
  title: "So What",
};
const folder = () => join(root, "songs/Miles Davis/Kind of Blue/So What");

describe("pushing a recording", () => {
  const push = (q: Record<string, string>, body: string): Promise<Response> =>
    fetch(`${base}/api/mediatek/recording?${new URLSearchParams(q)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body,
    });

  it("files it under the day and second the caller names", async () => {
    const res = await push(
      {
        filename: "take.mp3",
        at: new Date(2026, 7, 3, 21, 5, 7).toISOString(),
      },
      "ID3",
    );
    expect(res.status).toBe(200);
    // A ROOT zone: `recordings/…`, beside the families rather than inside songs.
    expect(await res.json()).toMatchObject({
      path: "recordings/2026-08-03/21-05-07.mp3",
      day: "2026-08-03",
    });
  });

  it("refuses a timestamp it cannot read", async () => {
    // Rather than falling back to now: a caller that sent one cares where the file lands.
    const res = await push({ filename: "take.mp3", at: "hier soir" }, "ID3");
    expect(res.status).toBe(400);
  });

  it("refuses a non-audio file and an empty body", async () => {
    expect((await push({ filename: "notes.txt" }, "x")).status).toBe(400);
    expect((await push({ filename: "take.mp3" }, "")).status).toBe(400);
  });

  it("shows up in the zone's listing and in NO catalogue listing", async () => {
    await push(
      {
        filename: "take.mp3",
        at: new Date(2026, 7, 3, 21, 5, 7).toISOString(),
      },
      "ID3",
    );
    const zone = (await (
      await fetch(`${base}/api/mediatek/recordings`)
    ).json()) as { days: { day: string; files: { name: string }[] }[] };
    expect(zone.days[0].day).toBe("2026-08-03");
    expect(zone.days[0].files[0].name).toBe("21-05-07.mp3");

    const listed = (await (
      await fetch(`${base}/api/mediatek/list?family=songs`)
    ).json()) as { entries: unknown[] };
    expect(listed.entries).toEqual([]);
  });
});

describe("uploading a song", () => {
  it("creates the deduced tree from the tags alone", async () => {
    const res = await post(tags, "ID3-bytes");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      path: "songs/Miles Davis/Kind of Blue/So What",
      master: "songs/Miles Davis/Kind of Blue/So What/original.mp3",
      replaced: false,
    });
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe(
      "ID3-bytes",
    );
    expect(existsSync(join(folder(), "song.yaml"))).toBe(true);
  });

  it("answers 409 rather than clobbering, and replaces when told to", async () => {
    await post(tags, "first");
    const again = await post(tags, "second");
    expect(again.status).toBe(409);
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe("first");

    const forced = await post({ ...tags, replace: "1" }, "second");
    expect(forced.status).toBe(200);
    expect(readFileSync(join(folder(), "original.mp3"), "utf8")).toBe("second");
  });

  it("refuses what is not audio, and an empty body", async () => {
    expect((await post({ ...tags, filename: "cover.jpg" }, "x")).status).toBe(
      400,
    );
    expect((await post(tags, "")).status).toBe(400);
  });

  it("cannot be talked into writing outside its family", async () => {
    // A tag is not a path: separators become spaces, so this lands INSIDE songs/ and nowhere else.
    const res = await post({ ...tags, artist: "../../.." }, "x");
    expect(res.status).toBe(200);
    const { path } = (await res.json()) as { path: string };
    expect(path).toMatch(/^songs\//);
    // Four segments pins that `songs/` did not quietly grow a provenance level back.
    expect(path.split("/")).toHaveLength(4);
  });
});

describe("uploading a variant", () => {
  const variant = (
    q: Record<string, string>,
    body: string,
  ): Promise<Response> =>
    fetch(`${base}/api/mediatek/variant?${new URLSearchParams(q)}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body,
    });
  const song = "songs/Miles Davis/Kind of Blue/So What";

  it("lands beside the master and comes back in the song's listing", async () => {
    await post(tags, "ID3");
    const res = await variant(
      { path: song, filename: "instrumental.wav" },
      "RIFF",
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      path: `${song}/instrumental.wav`,
      ref: "instrumental.wav",
      name: "instrumental",
      declared: true,
    });
    expect(readFileSync(join(folder(), "instrumental.wav"), "utf8")).toBe(
      "RIFF",
    );
    // What the tree draws its children from — the listing, not the folder.
    const listed = (await (
      await fetch(`${base}/api/mediatek/list?family=songs`)
    ).json()) as { entries: { variants?: unknown[] }[] };
    expect(listed.entries[0].variants).toEqual([
      { name: "instrumental", ref: "instrumental.wav", kind: "file" },
    ]);
  });

  it("refuses a folder that is not a song, and what is not audio", async () => {
    await post(tags, "ID3");
    // The album above it: a real folder, and not a morceau. Nobody invents a place in songs/.
    expect(
      (
        await variant(
          { path: "songs/Miles Davis/Kind of Blue", filename: "x.wav" },
          "RIFF",
        )
      ).status,
    ).toBe(400);
    expect(
      (await variant({ path: song, filename: "cover.jpg" }, "x")).status,
    ).toBe(400);
    expect((await variant({ path: song, filename: "x.wav" }, "")).status).toBe(
      400,
    );
  });

  it("removes the file and the sidecar's line, and drops out of the listing", async () => {
    await post(tags, "ID3");
    await variant({ path: song, filename: "instrumental.wav" }, "RIFF");
    const res = await fetch(
      `${base}/api/mediatek/variant?${new URLSearchParams({ path: song, name: "instrumental" })}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(200);
    expect(existsSync(join(folder(), "instrumental.wav"))).toBe(false);
    const listed = (await (
      await fetch(`${base}/api/mediatek/list?family=songs`)
    ).json()) as { entries: { variants?: unknown[] }[] };
    // Omitted rather than empty — the scan only sets the field when there is at least one.
    expect(listed.entries[0].variants).toBeUndefined();
  });

  it("refuses a name the sidecar does not declare", async () => {
    await post(tags, "ID3");
    const res = await fetch(
      `${base}/api/mediatek/variant?${new URLSearchParams({ path: song, name: "nope" })}`,
      { method: "DELETE" },
    );
    expect(res.status).toBe(400);
  });
});

// The read side: `/file` guesses a content type, and a wrong guess is a file the browser refuses.
describe("GET /file", () => {
  const put = (rel: string, body: string) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
    return abs;
  };

  it("serves a cover as an image, which it could not before", () => {
    put("songs/a/b/c/cover.jpg", "\xff\xd8\xff");
    return fetch(`${base}/api/mediatek/file?path=songs/a/b/c/cover.jpg`).then(
      async (r) => {
        expect(r.status).toBe(200);
        expect(r.headers.get("content-type")).toBe("image/jpeg");
      },
    );
  });

  it("serves an amp model as json", async () => {
    put("library/nam/fender.nam", "{}");
    const r = await fetch(
      `${base}/api/mediatek/file?path=library/nam/fender.nam`,
    );
    expect(r.headers.get("content-type")).toBe("application/json");
  });

  // This shell's own 404 ladder: a folder is a distinct answer from a missing path.
  it("refuses a directory as not a file", async () => {
    mkdirSync(join(root, "songs", "adir"), { recursive: true });
    const r = await fetch(`${base}/api/mediatek/file?path=songs/adir`);
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: string }).error).toBe("not a file");
  });

  it("answers 400 for a path that escapes the root, never 500", async () => {
    const r = await fetch(`${base}/api/mediatek/file?path=../../secret`);
    expect(r.status).toBe(400);
  });
});

describe("GET /stream", () => {
  // The FLAC branch shells out to ffmpeg, which decode.test.ts's own convention avoids in a
  // unit test (absent from a dev machine, present in the image) — covered here only for the
  // passthrough case, which needs no decoder at all.
  const put = (rel: string, body: string) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
    return abs;
  };

  it("passes a non-FLAC straight through, same bytes", async () => {
    put("songs/a/b/c/master.mp3", "not really mp3 bytes");
    const r = await fetch(
      `${base}/api/mediatek/stream?path=songs/a/b/c/master.mp3`,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("audio/mpeg");
    expect(await r.text()).toBe("not really mp3 bytes");
  });

  it("answers 404 for a path that is not there, same as /file", async () => {
    const r = await fetch(`${base}/api/mediatek/stream?path=songs/nope.mp3`);
    expect(r.status).toBe(404);
  });

  it("answers 400 for a path that escapes the root, never 500", async () => {
    const r = await fetch(`${base}/api/mediatek/stream?path=../../secret`);
    expect(r.status).toBe(400);
  });
});

describe("GET /search and /list", () => {
  it("clamps a greedy limit rather than refusing it", async () => {
    const r = await fetch(`${base}/api/mediatek/search?limit=99999`);
    expect(r.status).toBe(200);
    expect(
      Array.isArray(((await r.json()) as { entries: unknown[] }).entries),
    ).toBe(true);
  });

  // The refusal both shells now share, so a fifth family cannot leave one of them behind.
  it("refuses a bogus family with the shared sentence", async () => {
    const r = await fetch(`${base}/api/mediatek/list?family=bogus`);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe(FAMILY_ERROR);
  });
});
