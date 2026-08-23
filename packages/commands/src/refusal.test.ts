import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import type { CommandHost } from "./commands";

// The refusal channel, pinned two ways — see docs/refusal.md.

const said: string[] = [];
let refused = false;
const host = () =>
  ({
    songPath: "",
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => said.push(...l),
    refuse: (l: string[]) => {
      refused = true;
      said.push(...l);
    },
    reload: () => {},
  }) as unknown as CommandHost;

describe("refusals are marked", () => {
  it("a line that never dispatches is a refusal", async () => {
    said.length = 0;
    refused = false;
    await runCommand("frobnicate the wombat", host(), "cli");
    expect(said.join(" ")).toContain("unknown command");
    expect(refused).toBe(true);
  });

  it("a handler that declines its arguments is a refusal", async () => {
    said.length = 0;
    refused = false;
    await runCommand("node bypass", host(), "cli");
    expect(said.join(" ")).toContain("usage:");
    expect(refused).toBe(true);
  });
});

// A handler that RETURNS instead of working is refusing; a source check, see docs/refusal.md.
describe("no handler says no through log", () => {
  // A bare `<verb> list`-shaped call: the listing IS the answer, so it reports and returns.
  const answers = ["names.length > 1"];

  it("every `h.log(...)` followed by a return is an answer, not a refusal", () => {
    const src = readFileSync(
      join(import.meta.dirname, "commands.ts"),
      "utf8",
    ).split("\n");
    const bad: string[] = [];
    for (let i = 0; i < src.length; i++) {
      if (!src[i].includes("h.log([")) continue;
      let j = i;
      while (j < src.length && !src[j].trimEnd().endsWith("]);")) j++;
      const block = src.slice(i, j + 1).join(" ");
      if (!(src[j + 1] ?? "").trim().startsWith("return")) continue;
      if (answers.some((a) => block.includes(a))) continue;
      bad.push(`${i + 1}: ${block.trim().slice(0, 90)}`);
    }
    expect(bad).toEqual([]);
  });

  it("every handler's own catch refuses", () => {
    const src = readFileSync(join(import.meta.dirname, "commands.ts"), "utf8");
    const caught = src
      .split("\n")
      .filter((l) => l.includes("h.log([") && l.includes("as Error).message"));
    expect(caught).toEqual([]);
  });
});
