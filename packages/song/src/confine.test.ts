import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confineTo, confineToProject, projectRoots } from "./confine";
import { faustFilesOf } from "./faustFiles";
import { resolveRackAudio } from "./loader";
import { compileNodeProject } from "./nodeProject";
import { loadAudioClipDoc } from "./project";
import { copyAsYaml, writeYaml } from "./testSupport";

// A path a song file names may not leave the project's roots: other accounts' files sit beside it.

const here = dirname(fileURLToPath(import.meta.url));
const SONG = join(here, "..", "..", "..", "demos", "node-demo.k7");

let base: string;
let home: string;
let ws: string;
let project: string;
let other: string;
const saved = { ...process.env };

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "confine-")));
  home = join(base, "alice");
  ws = join(home, "workspace", "main");
  project = join(ws, "song");
  other = join(base, "bob", "workspace", "main", "secret.wav");
  mkdirSync(dirname(other), { recursive: true });
  writeFileSync(other, "RIFF");
  mkdirSync(join(base, "libraries", "drums", "samples"), { recursive: true });
  writeFileSync(
    join(base, "libraries", "drums", "samples", "kick.wav"),
    "RIFF",
  );
  mkdirSync(join(base, "libraries", ".sync-relay"), { recursive: true });
  writeFileSync(join(base, "libraries", ".sync-relay", "log"), "x");
  process.env.STUDIO_HOME = home;
  process.env.STUDIO_LIBRARIES_HOME = join(base, "libraries");
  delete process.env.STUDIO_MODELS;
  copyAsYaml(SONG, project, { recursive: true });
});
afterEach(() => {
  process.env = { ...saved };
  rmSync(base, { recursive: true, force: true });
});

describe("confineTo", () => {
  it("answers a path inside a root, absolute and normalised", () => {
    expect(confineTo([project], join(project, "clips", "..", "a.wav"))).toBe(
      join(project, "a.wav"),
    );
    expect(confineTo([project], project)).toBe(project);
  });

  it("refuses a `..` out, an absolute path elsewhere, a sibling prefix and a NUL", () => {
    expect(confineTo([project], join(project, "..", "..", "x"))).toBeNull();
    expect(confineTo([project], other)).toBeNull();
    expect(confineTo([project], `${project}-evil/a.wav`)).toBeNull();
    expect(confineTo([project], join(project, "a\0.wav"))).toBeNull();
    expect(confineTo([project], "")).toBeNull();
  });

  it("refuses a symlink inside the root that leads out of every root", () => {
    symlinkSync(dirname(other), join(project, "out"));
    expect(confineTo([project], join(project, "out", "secret.wav"))).toBeNull();
    expect(confineTo([project], join(project, "out", "new.wav"))).toBeNull();
  });

  it("refuses a dangling link, which a write would follow out", () => {
    symlinkSync(join(dirname(other), "planted.wav"), join(project, "trap.wav"));
    expect(confineTo([project], join(project, "trap.wav"))).toBeNull();
  });

  it("accepts a link from one allowed root into another", () => {
    symlinkSync(join(base, "libraries", "drums"), join(project, "lib"));
    expect(
      confineTo(
        projectRoots(project),
        join(project, "lib", "samples", "kick.wav"),
      ),
    ).not.toBeNull();
  });
});

describe("projectRoots", () => {
  it("reaches the workspace, each library and the renders, never another account or the relay", () => {
    const lib = join(base, "libraries", "drums", "samples", "kick.wav");
    expect(confineToProject(project, lib)).toBe(lib);
    expect(confineToProject(project, "../_modules/x/a.wav")).toBe(
      join(ws, "_modules", "x", "a.wav"),
    );
    expect(
      confineToProject(project, join(home, ".renders", "a.wav")),
    ).not.toBeNull();
    expect(
      confineToProject(project, "../../../../bob/workspace/main/secret.wav"),
    ).toBeNull();
    expect(confineToProject(project, other)).toBeNull();
    expect(
      confineToProject(project, join(base, "libraries", ".sync-relay", "log")),
    ).toBeNull();
  });
});

describe("the compiler", () => {
  it("names an escaping clip source as a compile issue rather than playing it", () => {
    writeYaml(join(project, "clips", "kick.yaml"), { source: other });
    expect(() => compileNodeProject(project)).toThrow(/outside the project/);
    writeYaml(join(project, "clips", "kick.yaml"), {
      source: "../../../../bob/workspace/main/secret.wav",
    });
    expect(() => compileNodeProject(project)).toThrow(/outside the project/);
  });

  it("gives the unplaced clip doc no file for an escaping source", () => {
    writeYaml(join(project, "clips", "kick.yaml"), { source: other });
    expect(loadAudioClipDoc(project, "kick")?.source).toBe("");
  });

  it("still compiles a project whose clips stay inside", () => {
    expect(() => compileNodeProject(project)).not.toThrow();
  });

  it("drops a rack sound that escapes and keeps a library one", () => {
    const rack = resolveRackAudio(
      {
        rackType: "samples",
        symbols: {
          BD: { note: 36, clip: other },
          SD: {
            note: 38,
            clip: "../../../../../bob/workspace/main/secret.wav",
          },
          HH: { note: 42, sample: "@drums/kick.wav" },
        },
      } as never,
      join(project, "modules", "rack", "kit"),
      project,
    ) as { symbols: Record<string, { clip?: string }> };
    expect(rack.symbols.BD.clip).toBeUndefined();
    expect(rack.symbols.SD.clip).toBeUndefined();
    expect(rack.symbols.HH.clip).toBe(
      join(base, "libraries", "drums", "samples", "kick.wav"),
    );
  });

  it("leaves a Faust slot that escapes unfilled", () => {
    writeFileSync(join(project, "table.wav"), "RIFF");
    const files = faustFilesOf(
      {
        a: other,
        b: "../../../../bob/workspace/main/secret.wav",
        c: "table.wav",
      },
      project,
    );
    expect(files).toEqual({ c: join(project, "table.wav") });
  });
});
