// The `library …` verbs: the pin moves to the newest version this k7 runs, a version that needs a
// newer k7 is refused by name, a version this machine lacks is asked of the host, and the forks
// whose base changed are named — the fork itself never touched.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const env = process.env.STUDIO_LIBRARIES_HOME;
const home0 = process.env.STUDIO_HOME;
let root: string;
let ws: string;
let home: string;
let fork: string;
let forkText: string;
const logs: string[] = [];
const refusals: string[] = [];

/** A host with a workspace and no project; `fetch` stands in for the hub. */
const host = (fetch?: (name: string, v: number) => Promise<string | null>) =>
  ({
    songPath: join(ws, "song.k7"),
    repoDir: ws,
    project: () => ({ tracks: [], groups: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => refusals.push(...l),
    reload: () => {},
    fetchLibraryVersion: fetch,
  }) as never;

/** Version `v` of `k7`, needing `requires`, with one module whose plugin is `plugin`. */
function version(v: number, requires: number, plugin: string): void {
  const at = join(home, "k7-core", String(v));
  writeDoc(join(at, "library.k7x"), { name: "k7-core", version: v, requires });
  writeDoc(join(at, "modules", "audio", "verb", "module.k7x"), { plugin });
}

const pins = () => wsData(join(ws, "_library-pins.k7x"));

beforeEach(() => {
  logs.length = 0;
  refusals.length = 0;
  root = mkdtempSync(join(tmpdir(), "td-library-"));
  ws = join(root, "ws");
  home = join(root, "libraries");
  process.env.STUDIO_LIBRARIES_HOME = home;
  // The account library is under $STUDIO_HOME: never the developer's own.
  process.env.STUDIO_HOME = join(root, "home");
  version(1, 1, "old");
  version(2, 1, "new");
  version(3, 99, "future");
  fork = join(ws, "_modules", "audio", "my-verb", "module.k7x");
  writeDoc(fork, { extends: "@k7-core/audio/verb" });
  forkText = readFileSync(fork, "utf8");
  writeDoc(join(ws, "_library-pins.k7x"), { "k7-core": 1 });
});
afterEach(() => {
  process.env.STUDIO_LIBRARIES_HOME = env;
  if (home0 === undefined) delete process.env.STUDIO_HOME;
  else process.env.STUDIO_HOME = home0;
  rmSync(root, { recursive: true, force: true });
});

describe("library upgrade", () => {
  it("moves to the newest version this k7 runs, and names the fork whose base changed", async () => {
    await runCommand("library upgrade k7-core", host(), "cli");
    expect(refusals).toEqual([]);
    expect(pins()).toEqual({ "k7-core": 2 });
    expect(logs).toEqual([
      "@k7-core: 1 → 2",
      "  _modules/audio/my-verb extends @k7-core/audio/verb, which changed",
    ]);
    expect(readFileSync(fork, "utf8")).toBe(forkText);
  });

  it("upgrades a legacy YAML pins file once, and moves the pin in the .k7x one", async () => {
    rmSync(join(ws, "_library-pins.k7x"));
    writeFileSync(join(ws, "_library-pins.yaml"), "k7-core: 1\n");
    await runCommand("library upgrade k7-core", host(), "cli");
    expect(refusals).toEqual([]);
    expect(pins()).toEqual({ "k7-core": 2 });
    expect(existsSync(join(ws, "_library-pins.yaml"))).toBe(false);
  });

  it("refuses a version that needs a newer k7, and leaves the pin alone", async () => {
    await runCommand("library upgrade k7-core 3", host(), "cli");
    expect(refusals[0]).toMatch(/needs k7 level 99/);
    expect(pins()).toEqual({ "k7-core": 1 });
  });

  it("asks the host for a version this machine lacks, and refuses with its reason", async () => {
    const asked: string[] = [];
    await runCommand(
      "library upgrade k7-core 4",
      host(async (name, v) => {
        asked.push(`${name} ${v}`);
        return "the origin cannot be reached";
      }),
      "cli",
    );
    expect(asked).toEqual(["k7-core 4"]);
    expect(refusals).toEqual(["@k7-core 4: the origin cannot be reached"]);
    expect(pins()).toEqual({ "k7-core": 1 });
  });

  it("lists what each library plays and what is ready", async () => {
    await runCommand("library versions", host(), "cli");
    expect(logs).toEqual([
      "@k7-core: plays 1; here 1, 2, 3 (needs level 99) — 2 is ready: library upgrade k7-core",
    ]);
  });
});
