// A module's `mix:` — the ENGINE's dry/wet around it — reaches the engine as its plugin's `@mix`
// param, beside the plugin's own, and inherits through `extends` like any field. Absent, it is not
// sent at all: all wet is what the engine does with nothing (engine/st0-engine/docs/mix.md).

import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { compileNodeProject } from "./nodeProject";
import { copyAsYaml } from "./testSupport";

const here = dirname(fileURLToPath(import.meta.url));
const DEMOS = join(here, "..", "..", "..", "demos");

let ws: string;
let dir: string;

const lead = () =>
  compileNodeProject(dir)
    .tracks.flatMap((t) => t.plugins ?? [])
    .find((p) => p.id.endsWith(":lead"));

beforeEach(() => {
  ws = mkdtempSync(join(tmpdir(), "td-mix-"));
  dir = join(ws, "synth-demo.st0");
  copyAsYaml(join(DEMOS, "synth-demo.st0"), dir, { recursive: true });
  copyAsYaml(join(DEMOS, "_modules"), join(ws, "_modules"), {
    recursive: true,
  });
});
afterEach(() => rmSync(ws, { recursive: true, force: true }));

it("sends no @mix when the module states none", () => {
  expect(lead()?.params["@mix"]).toBeUndefined();
});

it("sends the node's own mix as @mix", () => {
  appendFileSync(join(dir, "nodes", "lead.yaml"), "mix: 0.3\n");
  expect(lead()?.params["@mix"]).toBe(0.3);
});
