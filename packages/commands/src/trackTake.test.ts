// The three take verbs, through the DISPATCHER and asserting the FILE — the same rule
// trackMuteSolo.test.ts states: a command that reports one state and writes another is exactly
// what a writer-only test cannot see. The writers themselves are tested in @studio/song's
// yaml/takes.test.ts. See packages/song/docs/takes.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrackDoc } from "@studio/song/project";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
let reloaded = 0;

const LANE = `extends: "@studio/audio-track"
events:
  - { ref: pass3, start: "3:1" }
takes:
  - events:
      - { ref: pass1, start: "3:1" }
  - events:
      - { ref: pass2, start: "3:1" }
`;

function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-take-cmd-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  writeFileSync(join(d, "chains.yaml"), "modules:\n  gtr: [ OUT ]\n", "utf8");
  mkdirSync(join(d, "nodes"), { recursive: true });
  writeFileSync(join(d, "nodes", "gtr.yaml"), LANE, "utf8");
  return d;
}

const host = () =>
  ({
    songPath: dir,
    project: () => ({
      tracks: [{ id: "gtr", name: "gtr", plugins: [] } as unknown as TrackDoc],
      groups: [],
    }),
    applyProject: () => {},
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;

const lane = () =>
  parse(readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8"), {
    version: "1.2",
  });
const refs = (list: { ref: string }[] | undefined) =>
  (list ?? []).map((c) => c.ref);

beforeEach(() => {
  dir = song();
  logs.length = 0;
  reloaded = 0;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("track take select", () => {
  it("SWAPS: the take goes onto the lane and what played becomes that take", async () => {
    await runCommand("track take select gtr 1", host(), "cli");
    const m = lane();
    expect(refs(m.events)).toEqual(["pass1"]);
    expect(refs(m.takes[0].events)).toEqual(["pass3"]);
    expect(refs(m.takes[1].events)).toEqual(["pass2"]); // untouched
    expect(reloaded).toBe(1);
  });

  it("is its own undo — auditioning a take loses nothing", async () => {
    const before = readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");
    await runCommand("track take select gtr 2", host(), "cli");
    await runCommand("track take select gtr 2", host(), "cli");
    expect(readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8")).toBe(before);
  });

  it("refuses a number nothing answers to, and writes nothing", async () => {
    const before = readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");
    await runCommand("track take select gtr 3", host(), "cli");
    expect(logs.join(" ")).toContain("no take 3");
    expect(readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8")).toBe(before);
    expect(reloaded).toBe(0);
  });

  it("says which mistake it was: the track, the number, or the missing argument", async () => {
    await runCommand("track take select nope 1", host(), "cli");
    expect(logs.join(" ")).toContain('no track "nope"');
    // A non-number never reaches the handler: the catalogue declares the argument's type, so
    // the dispatcher answers that one.
    await runCommand("track take select gtr x", host(), "cli");
    expect(logs.join(" ")).toContain("expects a number");
    // …but 0 IS a number, and takes count from 1.
    await runCommand("track take select gtr 0", host(), "cli");
    expect(logs.join(" ")).toContain("count from 1");
    await runCommand("track take select gtr", host(), "cli");
    expect(logs.join(" ")).toContain("usage: track take select");
  });
});

describe("track take delete", () => {
  it("removes that one, and the events it held", async () => {
    await runCommand("track take delete gtr 1", host(), "cli");
    const m = lane();
    expect(m.takes).toHaveLength(1);
    expect(refs(m.takes[0].events)).toEqual(["pass2"]);
    expect(refs(m.events)).toEqual(["pass3"]); // the lane keeps playing what it played
  });

  it("leaves NO empty list when the last one goes", async () => {
    await runCommand("track take delete gtr 2", host(), "cli");
    await runCommand("track take delete gtr 1", host(), "cli");
    expect(readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8")).not.toContain(
      "takes",
    );
  });
});

describe("track take keep", () => {
  it("keeps what the lane plays and deletes every take", async () => {
    // The end of choosing: you listened round the takes — each listen a `select`, which leaves
    // the one you liked ON the lane — and this says that one.
    await runCommand("track take select gtr 1", host(), "cli");
    await runCommand("track take keep gtr", host(), "cli");
    const text = readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");
    expect(refs(lane().events)).toEqual(["pass1"]);
    expect(text).not.toContain("takes");
    expect(logs.join(" ")).toContain("deleted 2 takes");
  });

  it("says so rather than writing when there is nothing to keep from", async () => {
    await runCommand("track take keep gtr", host(), "cli");
    logs.length = 0;
    reloaded = 0;
    const before = readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8");
    await runCommand("track take keep gtr", host(), "cli");
    expect(logs.join(" ")).toContain("no takes");
    expect(readFileSync(join(dir, "nodes", "gtr.yaml"), "utf8")).toBe(before);
    expect(reloaded).toBe(0);
  });
});
