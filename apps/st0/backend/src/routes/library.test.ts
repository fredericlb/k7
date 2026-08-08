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

// The router alone, with no auth in front: what this covers is the upload's own contract —
// which status a caller gets and what lands on disk. Who may call it is server.ts's job.
let root: string;
let server: Server;
let base: string;

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "mediatek-http-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  const app = express();
  // Mounted the way server.ts mounts it, json parser included: a global json() ahead of a
  // raw() route is exactly the arrangement that silently eats a body when it guesses wrong.
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
    // A tag is not a path: the separators become spaces, so this lands in a comically
    // named folder INSIDE songs/ and nowhere else.
    const res = await post({ ...tags, artist: "../../.." }, "x");
    expect(res.status).toBe(200);
    const { path } = (await res.json()) as { path: string };
    expect(path).toMatch(/^songs\//);
    // The artist is now the FIRST segment below the family, with no provenance level in
    // between — so this also pins that `songs/` did not quietly grow one back.
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
});

// The read side. `/file` guesses a content type from the extension, and this shell and the file
// service's used to do it from two different tables — so a cover served from here went out as
// octet-stream while the cache could send it, and an AIFF the other way round.
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

  // This shell's own 404 ladder, which is NOT the cache's and stays its own: a folder is a
  // distinct answer from a missing path.
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

describe("POST /engine-faces", () => {
  const faces = (plugins: unknown[]): Promise<Response> =>
    fetch(`${base}/api/mediatek/engine-faces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugins }),
    });

  const created = async (r: Response): Promise<string[]> =>
    ((await r.json()) as { created: string[] }).created;

  const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

  it("files each plugin under its type and its category", async () => {
    const r = await faces([
      { name: "ADClip 7", role: "audioEffect", category: "dynamics" },
      { name: "ARP 2600 V3", role: "instrument", category: "instrument|synth" },
    ]);
    expect(r.status).toBe(200);
    expect(await created(r)).toEqual([
      "modules/audio/dynamics/adclip-7/module.yaml",
      "modules/instruments/synth/arp-2600-v3/module.yaml",
    ]);
    // Nothing but the ref: the scan already knows what the plugin IS, and a copy of it here
    // would be a staler second one.
    expect(read("modules/audio/dynamics/adclip-7/module.yaml")).toContain(
      'extends: "@engine/adclip-7"',
    );
  });

  it("runs twice without writing twice", async () => {
    const scan = [{ name: "Bite", category: "distortion" }];
    await faces(scan);
    expect(await created(await faces(scan))).toEqual([]);
  });

  it("leaves a face somebody filed under their own name alone", async () => {
    // By REF, not by path. `audio/distortion/bitcrush` extending `@engine/de-rez` IS that
    // plugin's face; a second one at the default path would give one plugin two names a chain
    // could reach it by.
    mkdirSync(join(root, "modules/audio/distortion/bitcrush"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "modules/audio/distortion/bitcrush/module.yaml"),
      'extends: "@engine/de-rez"\n',
      "utf8",
    );
    expect(
      await created(await faces([{ name: "de-rez", category: "distortion" }])),
    ).toEqual([]);
    expect(existsSync(join(root, "modules/audio/distortion/de-rez"))).toBe(
      false,
    );
  });

  it("does not overwrite a module that happens to sit at the same path", async () => {
    // It cannot be a face — that case is caught above — so it is somebody's own module, and
    // this pass must not destroy work to make room for a two-line stub.
    mkdirSync(join(root, "modules/audio/dynamics/adclip-7"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "modules/audio/dynamics/adclip-7/module.yaml"),
      "plugin: { type: jsdsp }\n",
      "utf8",
    );
    await faces([{ name: "ADClip 7", category: "dynamics" }]);
    expect(read("modules/audio/dynamics/adclip-7/module.yaml")).toContain(
      "jsdsp",
    );
  });

  it("refuses a body that is not a plugin list", async () => {
    const r = await fetch(`${base}/api/mediatek/engine-faces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plugins: "all of them" }),
    });
    expect(r.status).toBe(400);
  });
});
