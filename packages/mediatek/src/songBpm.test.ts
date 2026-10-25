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
import { setSongBpm, setSongKey } from "./write.ts";

let root: string;
const FOLDER = "songs/Miles/Kind of Blue/So What";

const sidecar = (body: string) => {
  const abs = join(root, ...FOLDER.split("/"));
  writeFileSync(join(abs, "song.yaml"), body, "utf8");
  // Said out loud, as `write.ts` says it for its own writes: the listing memo is keyed on a walk,
  // and a rewrite landing in the same file-time tick with the same file count reproduces its token.
  // Every test here gets a fresh root, so without this one of them is served the last one's answer.
  bumped("songs");
};
const read = () =>
  readFileSync(join(root, ...FOLDER.split("/"), "song.yaml"), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "mt-bpm-"));
  process.env.STUDIO_MEDIATEK = root;
  ensureLayout();
  // A folder with a master and a sidecar — a catalogued song.
  const abs = join(root, ...FOLDER.split("/"));
  writeFileSync(join(root, "mediatek.yaml"), "version: 1\n");
  mkdirSync(abs, { recursive: true });
  writeFileSync(join(abs, "original.wav"), "RIFF");
  sidecar('title: "So What"\nartist: "Miles"\n');
});
afterEach(async () => {
  // A listing persists the index in the background; removing the root under that write fails.
  await flushIndex();
  delete process.env.STUDIO_MEDIATEK;
  rmSync(root, { recursive: true, force: true });
});

describe("setSongBpm", () => {
  it("adds the tempo to a sidecar that has none", () => {
    expect(setSongBpm(FOLDER, 128.5)).toBe(true);
    expect(read()).toContain("bpm: 128.5");
  });

  it("REFUSES to overwrite one that is already there, whatever its value", () => {
    sidecar('title: "So What"\nbpm: 87\n');
    expect(setSongBpm(FOLDER, 174)).toBe(false);
    expect(read()).toContain("bpm: 87");
    expect(read()).not.toContain("174");
  });

  it("keeps the comments the sidecar carries", () => {
    // A YAML round trip would drop them, and they are what say the tree is derived.
    sidecar("# l'arborescence est déduite de ces champs\ntitle: T\n");
    setSongBpm(FOLDER, 120);
    expect(read()).toContain("# l'arborescence est déduite");
  });

  it("writes nothing for the engine's 'no tempo found'", () => {
    // 0 in the file would read as a claim; the absence is the honest state.
    expect(setSongBpm(FOLDER, 0)).toBe(false);
    expect(read()).not.toContain("bpm");
  });

  it("writes nothing for a folder with no sidecar — it does not catalogue one", () => {
    expect(setSongBpm("songs/Nobody/No Album/No Song", 120)).toBe(false);
  });

  it("survives a sidecar with no trailing newline", () => {
    sidecar("title: T");
    expect(setSongBpm(FOLDER, 90)).toBe(true);
    expect(read()).toBe("title: T\nbpm: 90\n");
  });
});

describe("the catalogue surfaces it", () => {
  it("reports a written tempo on the entry", async () => {
    setSongBpm(FOLDER, 128);
    const e = (await listFamilyFresh("songs")).entries.find(
      (x) => x.path === FOLDER,
    );
    expect(e?.meta?.bpm).toBe(128);
  });

  it("reads a quoted one too, since a person may write either", async () => {
    sidecar('title: T\nbpm: "92"\n');
    const e = (await listFamilyFresh("songs")).entries.find(
      (x) => x.path === FOLDER,
    );
    expect(e?.meta?.bpm).toBe(92);
  });

  it("carries no bpm at all when the sidecar has none", async () => {
    const e = (await listFamilyFresh("songs")).entries.find(
      (x) => x.path === FOLDER,
    );
    expect(e?.meta?.bpm).toBeUndefined();
  });
});

// The KEY, which lives here for the reason the tempo does: it is a fact about the RECORDING and
// does not change from one set to the next. What would be wrong silently: a `C# minor` truncated
// to `C` by YAML's comment marker, and a correction that a re-detection could undo.
describe("setSongKey", () => {
  it("adds a key to a sidecar that has none", () => {
    expect(setSongKey(FOLDER, "C# minor")).toBe(true);
    expect(read()).toContain('key: "C# minor"');
  });

  it("QUOTES it, or a sharp would start a YAML comment", async () => {
    // `key: C# minor` parses as `C` — the rest is a comment, and the mode vanishes without a word.
    setSongKey(FOLDER, "C# minor");
    expect((await listFamilyFresh("songs")).entries[0]?.meta?.key).toBe(
      "C# minor",
    );
  });

  it("does NOT overwrite by default — a correction survives a re-detection", () => {
    expect(setSongKey(FOLDER, "A minor")).toBe(true);
    expect(setSongKey(FOLDER, "E major")).toBe(false);
    expect(read()).toContain('key: "A minor"');
  });

  it("…but DOES when forced, which is what a person correcting it sends", () => {
    setSongKey(FOLDER, "A minor");
    expect(setSongKey(FOLDER, "E major", true)).toBe(true);
    expect(read()).toContain('key: "E major"');
    expect(read()).not.toContain("A minor");
  });

  it("refuses a shape that is not a key", () => {
    for (const bad of ["", "H minor", "8A", "C#", "C# mineur", "Cb major"])
      expect(setSongKey(FOLDER, bad), bad).toBe(false);
  });

  it("writes nothing at all to a folder with no sidecar", () => {
    expect(setSongKey("songs/Nobody/No album/No song", "C major")).toBe(false);
  });
});

describe("setSongBpm, forced", () => {
  it("replaces a corrected tempo when the person asks — the halve/double door", () => {
    setSongBpm(FOLDER, 174);
    expect(setSongBpm(FOLDER, 87)).toBe(false); // seeding still refuses
    expect(setSongBpm(FOLDER, 87, true)).toBe(true);
    expect(read()).toContain("bpm: 87");
    expect(read()).not.toContain("174");
  });

  it("leaves the rest of the sidecar alone, comments included", () => {
    sidecar('# what this record is\ntitle: "So What"\nbpm: 174\n');
    setSongBpm(FOLDER, 87, true);
    const after = read();
    expect(after).toContain("# what this record is");
    expect(after).toContain('title: "So What"');
    expect(after).toContain("bpm: 87");
  });
});
