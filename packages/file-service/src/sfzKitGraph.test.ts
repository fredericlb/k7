// An SFZ drum kit in the graph: its `kit:` pads reach the node as a rack's taps would, in note order, marked as
// a kit's — fixed, and played as notes through the node rather than as files. See packages/song/docs/racks.md.

import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeDoc } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fs-sfzkit-"));
  dir = join(root, "synth-demo.k7");
  cpSync(join(DEMOS, "synth-demo.k7"), dir, { recursive: true });
  const demoModules = join(DEMOS, "_modules");
  if (existsSync(demoModules))
    cpSync(demoModules, join(root, "_modules"), { recursive: true });
  // The demo's `synth`, made an SFZ kit with three pads, stated out of note order.
  writeDoc(join(root, "_modules", "instruments", "synth", "module.k7x"), {
    plugin: { type: "internal", name: "SFZ Player" },
    kit: { Snare: 38, Kick: 36, HatClosed: 42 },
  });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const lead = () =>
  buildGraphDoc(dir).chains.melody?.use.find((s) => s.module === "lead");

describe("an SFZ kit in the graph", () => {
  it("draws its pads as a rack's, in note order, marked as a kit's", () => {
    expect(lead()?.rack).toEqual([
      { symbol: "Kick", note: 36 },
      { symbol: "Snare", note: 38 },
      { symbol: "HatClosed", note: 42 },
    ]);
    expect(lead()?.rackKit).toBe(true);
  });
});
