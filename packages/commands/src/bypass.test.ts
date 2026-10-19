// `node bypass` — the command behind the graph's bypass button.
//
// The WRITER (setChainStepBypass) had a test and was correct. The command around it did
// not, and inverted the flag on its way there: it computed the state it wanted, reported
// that state in its log line, and then wrote the opposite. Clicking bypass on an active
// module "re-enabled" what was already on — visibly nothing — while the log said it had
// worked. A test on the writer alone could never see it; this one goes through the
// dispatcher, and asserts the FILE, not the message.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc, writeLane, writeModule } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;

/** A song with two modules on one chain, both active. */
function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-bypass-"));
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeDoc(join(d, "graph.k7x"), {
    modules: { gtr: ["amp"], amp: ["cab"], cab: ["OUT"] },
  });
  writeLane(d, "gtr", "track", { events: [] });
  for (const m of ["amp", "cab"])
    writeModule(d, "audio", m, { plugin: { type: "internal", name: "Chorus" } });
  return d;
}

const logs: string[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
    showNativePluginUI: () => {},
  }) as never;

/** Is `module` bypassed in the file right now? Read from disk, not from a return value. */
const bypassed = (module: string): boolean => {
  const graph = wsData(join(dir, "graph.k7x"));
  if (!(module in (graph.modules as object)))
    throw new Error(`no module "${module}" in graph.k7x`);
  return ((graph.bypassed ?? []) as string[]).includes(module);
};

beforeEach(() => {
  dir = song();
  logs.length = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("node bypass", () => {
  it("bypasses an active module, and says so", async () => {
    expect(bypassed("amp")).toBe(false);
    await runCommand("node bypass amp", host(), "cli");
    expect(bypassed("amp")).toBe(true);
    expect(logs.join(" ")).toContain("bypassed");
  });

  it("toggles back, leaving the other modules alone", async () => {
    await runCommand("node bypass amp", host(), "cli");
    await runCommand("node bypass amp", host(), "cli");
    expect(bypassed("amp")).toBe(false);
    expect(bypassed("cab")).toBe(false);
  });

  it("says what it did — the log and the file agree", async () => {
    // The inversion was invisible precisely because these two disagreed.
    for (const expected of [true, false, true]) {
      logs.length = 0;
      await runCommand("node bypass cab", host(), "cli");
      expect(bypassed("cab")).toBe(expected);
      expect(logs.join(" ")).toContain(expected ? "bypassed" : "active");
    }
  });

  it("takes an explicit state, which is not a toggle", async () => {
    await runCommand("node bypass amp on", host(), "cli");
    expect(bypassed("amp")).toBe(true);
    // Again: `on` means bypassed, so a second one must not flip it back.
    await runCommand("node bypass amp on", host(), "cli");
    expect(bypassed("amp")).toBe(true);
    await runCommand("node bypass amp off", host(), "cli");
    expect(bypassed("amp")).toBe(false);
  });
});
