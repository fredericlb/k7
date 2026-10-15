// Paths a song file names, used by a verb that deletes, copies or decodes: none may leave the project.
// Every account's file service runs as the same OS user, so `../` reaches another account's files.

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
import { compileNodeProject } from "@studio/song/nodeProject";
import { copyAsYaml, setYaml, writeYaml } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";
import { testHost } from "./testHost";

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "node-demo.k7");

let root: string;
let song: string;
let victim: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "td-confine-"));
  song = join(root, "ws", "song");
  victim = join(root, "other-account", "keep.wav");
  mkdirSync(dirname(victim), { recursive: true });
  writeFileSync(victim, "RIFF");
  copyAsYaml(SONG, song, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("node freeze", () => {
  it("unfreezes a module whose `frozen:` escapes without deleting what it names", async () => {
    setYaml(
      join(song, "nodes", "drums.yaml"),
      ["frozen"],
      "../../other-account/keep.wav",
    );
    const h = testHost({ songPath: song });
    await runCommand("node freeze drums", h, "cli");
    expect(existsSync(victim)).toBe(true);
    expect(h.lines.log.join("\n")).toMatch(/outside the project — left alone/);
  });

  it("still deletes a render inside the project", async () => {
    writeFileSync(join(song, "frozen.wav"), "RIFF");
    setYaml(join(song, "nodes", "drums.yaml"), ["frozen"], "frozen.wav");
    const h = testHost({ songPath: song });
    await runCommand("node freeze drums", h, "cli");
    expect(existsSync(join(song, "frozen.wav"))).toBe(false);
  });
});

describe("picture sound", () => {
  it("decodes no video a clip names outside the project", async () => {
    writeYaml(join(song, "video_tracks", "main.yaml"), {
      events: [{ ref: "shot", start: 0, length: 2 }],
    });
    writeYaml(join(song, "clips", "shot.yaml"), { source: "/etc/passwd.mp4" });
    const h = testHost({
      songPath: song,
      project: () => compileNodeProject(song),
    });
    await runCommand("picture sound main", h, "cli");
    expect(h.lines.log.join("\n")).toMatch(/outside the project/);
  });
});
