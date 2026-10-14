import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileNodeProject } from "@studio/song/nodeProject";
import { copyAsYaml, writeYaml } from "@studio/song/testSupport";
import { doubleSequence } from "@studio/song-schema/yaml/sequenceFile";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { halveLoopsOf } from "./sequenceLoops";

// ×2 on a LOOPED clip: the window doubles and the passes halve, so what plays is the same length
// and the two halves can now differ. Four passes of one beat become two of two — docs/sequenceLoops.md.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "synth-demo.st0");
const DEMO_MODULES = join(here, "..", "..", "..", "demos", "_modules");

let root: string;
let dir: string;
// synth-demo is 120bpm 4/4; its melody sequence gets one note per beat, windowed to the first.
const seq = (body: Record<string, unknown>) =>
  writeYaml(join(dir, "sequences", "melody.yaml"), {
    notes: Array.from({ length: 8 }, (_, i) => ({ t: i, d: 1, k: 60 + i })),
    ...body,
  });
const place = (p: Record<string, unknown>) =>
  writeYaml(join(dir, "nodes", "melody.yaml"), {
    extends: "@meta/track",
    events: [{ ref: "melody", start: "1:1:1", ...p }],
  });
const melody = () =>
  compileNodeProject(dir)
    .tracks.flatMap((t) => t.clips)
    .find((c) => c.name === "melody");

/** The ×2 button's whole act: the sequence doubled, then every placement of it halved. */
const double = () => {
  const f = join(dir, "sequences", "melody.yaml");
  writeFileSync(f, doubleSequence(readFileSync(f, "utf8"), 4, 4), "utf8");
  return halveLoopsOf(dir, "melody");
};
const laneText = () => readFileSync(join(dir, "nodes", "melody.yaml"), "utf8");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-seqx2-"));
  dir = join(root, "synth-demo.st0");
  copyAsYaml(SONG, dir, { recursive: true });
  copyAsYaml(DEMO_MODULES, join(root, "_modules"), { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("×2 on a looped placement", () => {
  it("turns four passes of one beat into two of two, playing the same span", () => {
    seq({ to: "1:2" }); // one beat of window
    place({ loop: 4 });
    expect(melody()?.length).toBe(4);
    expect(double().halved).toBe(1);
    expect(melody()?.length).toBe(4); // the arrangement did not move
    expect(laneText()).toContain("loop: 2");
  });

  it("writes NO loop when the last halving lands back on one pass", () => {
    // `loop: 1` is the default, and the default is written by not writing it.
    seq({ to: "1:2" });
    place({ loop: 2 });
    double();
    expect(laneText()).not.toContain("loop:");
    expect(melody()?.length).toBe(2);
  });

  it("leaves an ODD number of passes alone, and says which placement it was", () => {
    // Three passes of two beats is not three of one: halving would have to invent a half pass.
    seq({ to: "1:2" });
    place({ loop: 3 });
    const r = double();
    expect(r.halved).toBe(0);
    expect(r.kept).toEqual([
      { lane: "melody", start: "1:1:1", loop: 3, why: "odd" },
    ]);
    expect(melody()?.length).toBe(6); // twice as long, as the report says
  });

  it("leaves a placement that states its OWN window alone", () => {
    // The event's window did not grow with the material's, so halving would halve what plays.
    seq({ to: "1:2" });
    place({ loop: 4, to: "1:2" });
    const r = double();
    expect(r.halved).toBe(0);
    expect(r.kept[0]).toMatchObject({ why: "windowed" });
  });

  it("does nothing to a placement that is not looped", () => {
    seq({ to: "1:2" });
    place({});
    const r = double();
    expect(r).toMatchObject({ halved: 0, kept: [], files: [] });
    // …and that one IS twice as long now, which is what ×2 means with nothing repeating.
    expect(melody()?.length).toBe(2);
  });

  it("reaches every lane that places the sequence", () => {
    seq({ to: "1:2" });
    place({ loop: 4 });
    writeYaml(join(dir, "nodes", "second.yaml"), {
      extends: "@meta/track",
      events: [{ ref: "melody", start: "2:1:1", loop: 8 }],
    });
    expect(double()).toMatchObject({ halved: 2 });
    expect(readFileSync(join(dir, "nodes", "second.yaml"), "utf8")).toContain(
      "loop: 4",
    );
  });
});
