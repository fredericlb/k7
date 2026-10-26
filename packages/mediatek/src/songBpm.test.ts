// `bpm` is detected once and edited afterwards. What this pins is the refusal: re-analysing a
// song must never undo a correction, because the engine's estimate is a starting point that
// halves an octave on fast material (packages/file-service/docs/waveformCache.md).

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { flushIndex, listFamilyFresh } from "./catalogue.ts";
import { ensureLayout } from "./layout.ts";
import { bumped } from "./revision.ts";
import { readMasterTags, writeMasterTags } from "./tags.ts";
import { tinyWav } from "./testWav.ts";
import { setSongBpm, setSongKey } from "./write.ts";

let root: string;
const FOLDER = "songs/Miles/Kind of Blue/So What";
const SIDECAR = "# what this record is\nsource: upload\n";

const master = () => join(root, ...FOLDER.split("/"), "original.wav");
const tags = () => readMasterTags(master());
const sidecar = () =>
  readFileSync(join(root, ...FOLDER.split("/"), "song.yaml"), "utf8");

/** Tag the master directly, as another tool would have — and say so, as `write.ts` does for its own writes. */
const preset = async (t: Parameters<typeof writeMasterTags>[1]) => {
  await writeMasterTags(master(), t);
  bumped("songs");
};

const entry = async () =>
  (await listFamilyFresh("songs")).entries.find((x) => x.path === FOLDER);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mt-bpm-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  // A folder with a master and a sidecar — a catalogued song.
  const abs = join(root, ...FOLDER.split("/"));
  writeFileSync(join(root, "mediatek.yaml"), "version: 1\n");
  mkdirSync(abs, { recursive: true });
  writeFileSync(master(), tinyWav());
  writeFileSync(join(abs, "song.yaml"), SIDECAR, "utf8");
  // Every test here gets a fresh root, so without this one of them is served the last one's listing.
  bumped("songs");
});
afterEach(async () => {
  // A listing persists the index in the background; removing the root under that write fails.
  await flushIndex();
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

describe("setSongBpm", () => {
  it("adds the tempo to a master that has none, in its tags", async () => {
    expect(await setSongBpm(FOLDER, 128.5)).toBe(true);
    expect((await tags()).bpm).toBe(128.5);
  });

  it("REFUSES to overwrite one that is already there, whatever its value", async () => {
    await preset({ bpm: 87 });
    expect(await setSongBpm(FOLDER, 174)).toBe(false);
    expect((await tags()).bpm).toBe(87);
  });

  it("leaves the sidecar alone — the tempo is not its business", async () => {
    await setSongBpm(FOLDER, 120);
    expect(sidecar()).toBe(SIDECAR);
  });

  it("keeps the master's other tags", async () => {
    await preset({ title: "So What", artist: "Miles" });
    await setSongBpm(FOLDER, 120);
    expect(await tags()).toEqual({
      title: "So What",
      artist: "Miles",
      bpm: 120,
    });
  });

  it("writes nothing for the engine's 'no tempo found'", async () => {
    // 0 in the file would read as a claim; the absence is the honest state.
    expect(await setSongBpm(FOLDER, 0)).toBe(false);
    expect((await tags()).bpm).toBeUndefined();
  });

  it("writes nothing for a folder with no master — it does not invent one", async () => {
    expect(await setSongBpm("songs/Nobody/No Album/No Song", 120)).toBe(false);
  });
});

describe("the catalogue surfaces it", () => {
  it("reports a written tempo on the entry", async () => {
    await setSongBpm(FOLDER, 128);
    expect((await entry())?.meta?.bpm).toBe(128);
  });

  it("carries no bpm at all when the master has none", async () => {
    expect((await entry())?.meta?.bpm).toBeUndefined();
  });

  it("names the entry by its title tag, and the folder only when there is none", async () => {
    expect((await entry())?.name).toBe("So What");
    await preset({ title: "So What (Live)", artist: "Miles", album: "Kind" });
    const e = await entry();
    expect(e?.name).toBe("So What (Live)");
    expect(e?.meta).toMatchObject({ artist: "Miles", album: "Kind" });
  });
});

// The KEY, which lives here for the reason the tempo does: it is a fact about the RECORDING and
// does not change from one set to the next. What would be wrong silently: a correction that a
// re-detection could undo, or a sharp lost on the way through.
describe("setSongKey", () => {
  it("adds a key to a master that has none, sharp intact", async () => {
    expect(await setSongKey(FOLDER, "C# minor")).toBe(true);
    expect((await tags()).key).toBe("C# minor");
    expect((await entry())?.meta?.key).toBe("C# minor");
  });

  it("does NOT overwrite by default — a correction survives a re-detection", async () => {
    expect(await setSongKey(FOLDER, "A minor")).toBe(true);
    expect(await setSongKey(FOLDER, "E major")).toBe(false);
    expect((await tags()).key).toBe("A minor");
  });

  it("…but DOES when forced, which is what a person correcting it sends", async () => {
    await setSongKey(FOLDER, "A minor");
    expect(await setSongKey(FOLDER, "E major", true)).toBe(true);
    expect((await tags()).key).toBe("E major");
  });

  it("refuses a shape that is not a key", async () => {
    for (const bad of ["", "H minor", "8A", "C#", "C# mineur", "Cb major"])
      expect(await setSongKey(FOLDER, bad), bad).toBe(false);
  });

  it("writes nothing at all to a folder with no master", async () => {
    expect(await setSongKey("songs/Nobody/No album/No song", "C major")).toBe(
      false,
    );
  });
});

describe("setSongBpm, forced", () => {
  it("replaces a corrected tempo when the person asks — the halve/double door", async () => {
    await setSongBpm(FOLDER, 174);
    expect(await setSongBpm(FOLDER, 87)).toBe(false); // seeding still refuses
    expect(await setSongBpm(FOLDER, 87, true)).toBe(true);
    expect((await tags()).bpm).toBe(87);
  });
});
