// `track mute` / `track solo` — a lane's mute IS its module's bypass, and solo is PROJECT
// STATE: `soloed` at project.k7x's root lists the soloed lanes, several at once, and the
// engine resolves it across the mixer. These go through the dispatcher and assert the FILE,
// for the reason bypass.test.ts gives — a command that reports one state and writes another
// is exactly the bug a writer-only test cannot see.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TrackDoc } from "@studio/song/project";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
let applied: { tracks: TrackDoc[] } | null = null;

const track = (id: string, mute = false) =>
  ({ id, name: id, mute, solo: false, plugins: [] }) as unknown as TrackDoc;

/** Three lanes through one output; `project()` is the compiled doc the command reads. */
function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-mutesolo-"));
  writeDoc(join(d, "project.k7x"), {
    project: { name: "t", tempo: 120, sampleRate: 48000 },
  });
  writeDoc(join(d, "graph.k7x"), {
    modules: { gtr: ["OUT"], bass: ["OUT"], drums: ["OUT"] },
  });
  for (const t of ["gtr", "bass", "drums"])
    writeDoc(join(d, "nodes", `${t}.k7x`), {
      extends: "@meta/track",
      events: [],
    });
  return d;
}

let docTracks: TrackDoc[] = [];
const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: docTracks, groups: [] }),
    applyProject: (p: { tracks: TrackDoc[] }) => {
      applied = p;
    },
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {},
  }) as never;

/** The names `bypassed` lists right now, read from disk. */
const bypassed = (): string[] =>
  (wsData(join(dir, "graph.k7x")).bypassed as string[] | undefined) ?? [];

beforeEach(() => {
  dir = song();
  logs.length = 0;
  applied = null;
  docTracks = [track("gtr"), track("bass"), track("drums")];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("track mute", () => {
  it("writes the lane's name into `bypassed` and nothing else", async () => {
    await runCommand("track mute bass", host(), "cli");
    expect(bypassed()).toEqual(["bass"]);
    expect(logs.join(" ")).toContain("muted");
  });

  it("takes it back out, leaving no trace of the round trip", async () => {
    const before = readFileSync(join(dir, "graph.k7x"), "utf8");
    await runCommand("track mute bass", host(), "cli");
    docTracks = [track("gtr"), track("bass", true), track("drums")];
    await runCommand("track mute bass", host(), "cli");
    expect(readFileSync(join(dir, "graph.k7x"), "utf8")).toBe(before);
  });

  it("pushes the doc rather than making the caller reload", async () => {
    await runCommand("track mute bass", host(), "cli");
    expect(applied?.tracks.find((t) => t.id === "bass")?.mute).toBe(true);
    expect(applied?.tracks.find((t) => t.id === "gtr")?.mute).toBe(false);
  });

  it("says which mistake it was when the name is not a lane", async () => {
    await runCommand("track mute nope", host(), "cli");
    expect(logs.join(" ")).toContain('no track "nope"');
    expect(bypassed()).toEqual([]);
  });
});

describe("track solo", () => {
  const soloedInFile = (): string[] =>
    (wsData(join(dir, "project.k7x")).soloed as string[] | undefined) ?? [];

  it("writes the lane into project.k7x's `soloed` and bypasses nobody", async () => {
    await runCommand("track solo bass", host(), "cli");
    expect(soloedInFile()).toEqual(["bass"]);
    expect(bypassed()).toEqual([]); // the old derivation muted the others; the engine does now
    expect(logs.join(" ")).toContain("solo on");
  });

  it("holds SEVERAL solos at once — the list is the point", async () => {
    await runCommand("track solo bass", host(), "cli");
    await runCommand("track solo drums", host(), "cli");
    expect(soloedInFile()).toEqual(["bass", "drums"]);
  });

  it("toggles one lane out and DELETES the key with the last — absent is the default", async () => {
    await runCommand("track solo bass", host(), "cli");
    await runCommand("track solo drums", host(), "cli");
    await runCommand("track solo bass", host(), "cli");
    expect(soloedInFile()).toEqual(["drums"]);
    await runCommand("track solo drums", host(), "cli");
    expect(readFileSync(join(dir, "project.k7x"), "utf8")).not.toContain(
      "soloed",
    );
    expect(logs.join(" ")).toContain("solo off");
  });

  it("pushes the doc with the solo flags set, rather than making the caller reload", async () => {
    await runCommand("track solo bass", host(), "cli");
    expect(applied?.tracks.find((t) => t.id === "bass")?.solo).toBe(true);
    expect(applied?.tracks.find((t) => t.id === "gtr")?.solo).toBe(false);
  });

  it("un-mutes the lane it solos, so soloing a muted lane is one gesture", async () => {
    await runCommand("track mute bass", host(), "cli");
    docTracks = [track("gtr"), track("bass", true), track("drums")];
    await runCommand("track solo bass", host(), "cli");
    expect(bypassed()).toEqual([]); // its own bypass lifted, nobody else's written
    expect(applied?.tracks.find((t) => t.id === "bass")?.mute).toBe(false);
  });
});
