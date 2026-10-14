// An SFZ drum kit in the graph: its `kit:` pads reach the node as a rack's taps would, in note order, marked as
// a kit's — fixed, and played as notes through the node rather than as files. See packages/song/docs/racks.md.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { copyAsYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildGraphDoc } from "./graphDoc";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");

let root: string;
let dir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fs-sfzkit-"));
  dir = join(root, "synth-demo.st0");
  copyAsYaml(join(DEMOS, "synth-demo.st0"), dir, { recursive: true });
  const demoModules = join(DEMOS, "_modules");
  if (existsSync(demoModules))
    copyAsYaml(demoModules, join(root, "_modules"), { recursive: true });
  // The demo's `synth`, made an SFZ kit with three pads, stated out of note order.
  const folder = join(root, "_modules", "instruments", "synth");
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "module.yaml"),
    "plugin:\n  type: internal\n  name: SFZ Player\nkit:\n  Snare: 38\n  Kick: 36\n  HatClosed: 42\n",
    "utf8",
  );
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
