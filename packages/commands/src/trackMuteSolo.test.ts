// `track mute` / `track solo` — a lane's mute IS its module's bypass.
//
// Both used to write a flag onto the lane's own file. A lane is a module now
// (packages/song/docs/trackModules.md), so mute is one name in `chains.yaml`'s `bypassed:` and
// solo is not written down at all: it is the set of mutes it produces. These go through the
// dispatcher and assert the FILE, for the reason bypass.test.ts gives — a command that reports
// one state and writes another is exactly the bug a writer-only test cannot see.

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
import { runCommand } from "./commandSpec";

let dir: string;
const logs: string[] = [];
let applied: { tracks: TrackDoc[] } | null = null;

const track = (id: string, mute = false) =>
  ({ id, name: id, mute, solo: false, plugins: [] }) as unknown as TrackDoc;

/** Three lanes through one output; `project()` is the compiled doc the command reads. */
function song(): string {
  const d = mkdtempSync(join(tmpdir(), "td-mutesolo-"));
  writeFileSync(
    join(d, "project.yaml"),
    "project:\n  name: t\n  tempo: 120\n  sampleRate: 48000\n",
    "utf8",
  );
  writeFileSync(
    join(d, "chains.yaml"),
    "modules:\n  gtr: [ OUT ]\n  bass: [ OUT ]\n  drums: [ OUT ]\n",
    "utf8",
  );
  mkdirSync(join(d, "instances"), { recursive: true });
  for (const t of ["gtr", "bass", "drums"])
    writeFileSync(
      join(d, "instances", `${t}.yaml`),
      'extends: "@studio/audio-track"\nclips: []\n',
      "utf8",
    );
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
    reload: () => {},
  }) as never;

/** The names `bypassed:` lists right now, read from disk. */
const bypassed = (): string[] => {
  const line =
    readFileSync(join(dir, "chains.yaml"), "utf8")
      .split("\n")
      .find((l) => l.startsWith("bypassed:")) ?? "";
  return line
    .replace(/^bypassed:\s*\[?/, "")
    .replace(/\]\s*$/, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
};

beforeEach(() => {
  dir = song();
  logs.length = 0;
  applied = null;
  docTracks = [track("gtr"), track("bass"), track("drums")];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("track mute", () => {
  it("writes the lane's name into `bypassed:` and nothing else", async () => {
    await runCommand("track mute bass", host(), "cli");
    expect(bypassed()).toEqual(["bass"]);
    expect(logs.join(" ")).toContain("muted");
  });

  it("takes it back out, leaving no trace of the round trip", async () => {
    const before = readFileSync(join(dir, "chains.yaml"), "utf8");
    await runCommand("track mute bass", host(), "cli");
    docTracks = [track("gtr"), track("bass", true), track("drums")];
    await runCommand("track mute bass", host(), "cli");
    expect(readFileSync(join(dir, "chains.yaml"), "utf8")).toBe(before);
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
  it("bypasses every OTHER lane, and not the soloed one", async () => {
    await runCommand("track solo bass", host(), "cli");
    expect(bypassed().sort()).toEqual(["drums", "gtr"]);
    expect(logs.join(" ")).toContain("solo on");
  });

  it("lifts it by un-bypassing everything — there is no state to restore", async () => {
    await runCommand("track solo bass", host(), "cli");
    docTracks = [track("gtr", true), track("bass"), track("drums", true)];
    await runCommand("track solo bass", host(), "cli");
    expect(bypassed()).toEqual([]);
    expect(logs.join(" ")).toContain("solo off");
  });

  it("un-mutes the lane it solos, so soloing a muted lane is one gesture", async () => {
    await runCommand("track mute bass", host(), "cli");
    docTracks = [track("gtr"), track("bass", true), track("drums")];
    await runCommand("track solo bass", host(), "cli");
    expect(bypassed().sort()).toEqual(["drums", "gtr"]);
  });
});
