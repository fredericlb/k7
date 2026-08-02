import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GristClient, GristRecord } from "@frediverse/db-grist";
import { ensureLayout } from "@studio/mediatek/layout";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extFor, mirrorRadiok7, plan, sidecarFor, slugFor } from "./radiok7.ts";

const rec = (fields: Record<string, unknown>): GristRecord =>
  ({ id: 1, fields }) as GristRecord;

/** Grist with no server: two tables and an attachment store, enough to drive the mirror. */
function fakeGrist(
  releases: Record<string, unknown>[],
  versions: Record<string, unknown>[],
  attachments: Record<number, string> = {},
) {
  const downloads: number[] = [];
  const client = {
    listRecords: async (table: string, filter?: Record<string, unknown[]>) => {
      if (table === "Releases") return releases.map(rec);
      const want = filter?.ReleaseUid?.[0];
      return versions.filter((v) => v.ReleaseUid === want).map(rec);
    },
    downloadAttachment: async (id: number) => {
      downloads.push(id);
      if (!(id in attachments)) throw new Error(`no attachment ${id}`);
      return Buffer.from(attachments[id]);
    },
  } as unknown as GristClient;
  return { client, downloads };
}

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mediatek-mirror-"));
  process.env.LANES_MEDIATEK = root;
  ensureLayout();
});
afterEach(() => {
  delete process.env.LANES_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

const recorded = (...p: string[]) => join(root, "morceaux", "recorded", ...p);

const RELEASE = {
  Uid: "rel-1",
  Title: "Café Noir",
  Artist: "Les Copains",
  SongUuid: "song-abc",
};
const VERSION = {
  Uid: "ver-0123456789",
  ReleaseUid: "rel-1",
  Name: "Mix final",
  IsDefault: true,
  AudioId: 42,
  AudioMime: "audio/wav",
  CreatedAt: "2026-01-02T03:04:05Z",
};

describe("naming a mirrored folder", () => {
  const m = plan([rec(RELEASE)], new Map([["rel-1", [rec(VERSION)]]])).items[0];

  it("reads as artist - title (version)", () => {
    expect(slugFor(m)).toMatch(/^Les Copains - Cafe Noir \(Mix final\)/);
  });

  it("strips accents rather than the letters under them", () => {
    // A bare non-word strip on the composed form would have left "Caf".
    expect(slugFor(m)).toContain("Cafe Noir");
  });

  it("carries a tail of the upstream key, so two identical versions cannot collide", () => {
    const other = { ...m, key: "version:zzzzzzzzzzzz" };
    expect(slugFor(m)).not.toBe(slugFor(other));
    expect(slugFor(m)).toContain("[ver-0123");
  });

  it("drops the placeholder version name radiok7 uses when none was given", () => {
    expect(slugFor({ ...m, versionName: "Version" })).not.toContain(
      "(Version)",
    );
  });
});

describe("choosing an extension", () => {
  it("maps the formats radiok7 actually stores", () => {
    expect(extFor("audio/wav")).toBe(".wav");
    expect(extFor("audio/mpeg")).toBe(".mp3");
    expect(extFor("audio/flac")).toBe(".flac");
  });

  it("refuses to guess, because a wrong one reads as a lost take", () => {
    // The scan lists a morceau by finding an AUDIO file in the folder. Calling an unknown
    // blob `.wav` would make it playable-looking and broken; `.bin` makes it visibly not.
    expect(extFor("application/octet-stream")).toBe(".bin");
  });
});

describe("planning what to mirror", () => {
  it("flattens releases by their versions", () => {
    const { items } = plan(
      [rec(RELEASE)],
      new Map([
        [
          "rel-1",
          [rec(VERSION), rec({ ...VERSION, Uid: "ver-2", Name: "Rough" })],
        ],
      ]),
    );
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Café Noir");
    expect(items[1].versionName).toBe("Rough");
  });

  it("skips a version with no audio instead of inventing an empty morceau", () => {
    // A half-failed upload is a real upstream state. Mirrored as a folder, it would read
    // as a recording the library HAS and cannot play.
    const { items, skipped } = plan(
      [rec(RELEASE)],
      new Map([["rel-1", [rec({ ...VERSION, AudioId: 0 })]]]),
    );
    expect(items).toEqual([]);
    expect(skipped[0].reason).toMatch(/no audio/);
  });
});

describe("pulling", () => {
  it("writes the audio and the sidecar", async () => {
    const { client } = fakeGrist([RELEASE], [VERSION], { 42: "RIFFDATA" });
    const r = await mirrorRadiok7(client);
    expect(r.added).toHaveLength(1);
    const folder = r.added[0];
    expect(readFileSync(recorded(folder, "master.wav"), "utf8")).toBe(
      "RIFFDATA",
    );
    const side = readFileSync(recorded(folder, "morceau.yaml"), "utf8");
    expect(side).toContain('grist: "version:ver-0123456789"');
    expect(side).toContain("source: radiok7");
    expect(side).toContain('uuid: "song-abc"');
  });

  it("leaves no .part behind", async () => {
    const { client } = fakeGrist([RELEASE], [VERSION], { 42: "RIFFDATA" });
    const r = await mirrorRadiok7(client);
    expect(existsSync(recorded(r.added[0], "master.wav.part"))).toBe(false);
  });

  it("removes the folder it created when the download fails", async () => {
    // No attachment 42 registered, so downloadAttachment throws. A folder left behind
    // would be an uncatalogued husk the next run would not recognise as its own.
    const { client } = fakeGrist([RELEASE], [VERSION], {});
    const r = await mirrorRadiok7(client);
    expect(r.added).toEqual([]);
    expect(r.failed).toHaveLength(1);
    expect(
      existsSync(
        recorded(
          slugFor(
            plan([rec(RELEASE)], new Map([["rel-1", [rec(VERSION)]]])).items[0],
          ),
        ),
      ),
    ).toBe(false);
  });
});

// The point of the upstream key. A mirror that re-downloaded everything on every run would
// be a mirror nobody could afford to schedule.
describe("running it twice", () => {
  it("downloads nothing the second time", async () => {
    const { client, downloads } = fakeGrist([RELEASE], [VERSION], {
      42: "RIFFDATA",
    });
    await mirrorRadiok7(client);
    expect(downloads).toEqual([42]);
    const second = await mirrorRadiok7(client);
    expect(second.unchanged).toHaveLength(1);
    expect(second.added).toEqual([]);
    expect(downloads).toEqual([42]); // still just the one
  });

  it("refreshes the sidecar when the upstream title moved, without re-fetching", async () => {
    // Bytes are immutable upstream — a new mix is a new version — but a title is edited
    // freely. So metadata follows and audio does not.
    const releases = [{ ...RELEASE }];
    const { client, downloads } = fakeGrist(releases, [VERSION], {
      42: "RIFFDATA",
    });
    const first = await mirrorRadiok7(client);
    releases[0].Title = "Thé Vert";
    const second = await mirrorRadiok7(client);
    expect(second.updated).toEqual(first.added);
    expect(downloads).toEqual([42]);
    expect(
      readFileSync(recorded(first.added[0], "morceau.yaml"), "utf8"),
    ).toContain('title: "Thé Vert"');
  });

  it("does NOT rename the folder when the title moves", async () => {
    // The path is the catalogue entry's id and a cache's manifest key. Renaming would cost
    // every machine a full re-download of bytes that did not change.
    const releases = [{ ...RELEASE }];
    const { client } = fakeGrist(releases, [VERSION], { 42: "RIFFDATA" });
    const first = await mirrorRadiok7(client);
    releases[0].Title = "Thé Vert";
    await mirrorRadiok7(client);
    expect(existsSync(recorded(first.added[0]))).toBe(true);
    expect(first.added[0]).toContain("Cafe Noir");
  });

  it("finds its own work by the key, not by the folder name", async () => {
    // Somebody renamed the folder by hand. The mirror must still recognise it as mirrored,
    // or it would create a duplicate beside it on every single run.
    const { client, downloads } = fakeGrist([RELEASE], [VERSION], {
      42: "RIFFDATA",
    });
    const first = await mirrorRadiok7(client);
    const renamed = recorded("something entirely else");
    const { renameSync } = await import("node:fs");
    renameSync(recorded(first.added[0]), renamed);
    const second = await mirrorRadiok7(client);
    expect(second.added).toEqual([]);
    expect(second.unchanged).toEqual(["something entirely else"]);
    expect(downloads).toEqual([42]);
  });
});

describe("the sidecar", () => {
  it("tells a human not to edit it here", () => {
    const m = plan([rec(RELEASE)], new Map([["rel-1", [rec(VERSION)]]]))
      .items[0];
    expect(sidecarFor(m)).toMatch(/overwritten by the next pull/);
  });

  it("quotes every value, so a title with a colon cannot break the file", () => {
    const m = plan(
      [rec({ ...RELEASE, Title: "Reprise: le retour" })],
      new Map([["rel-1", [rec(VERSION)]]]),
    ).items[0];
    expect(sidecarFor(m)).toContain('title: "Reprise: le retour"');
  });
});
