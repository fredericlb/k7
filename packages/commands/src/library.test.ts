// The `library …` verbs: the pin moves to the newest version this k7 runs, a version that needs a
// newer k7 is refused by name, a version this machine lacks is asked of the host, and the forks
// whose base changed are named — the fork itself never touched.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const env = process.env.STUDIO_LIBRARIES_HOME;
const home0 = process.env.STUDIO_HOME;
let root: string;
let ws: string;
let home: string;
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
  mkdirSync(join(at, "modules", "audio", "verb"), { recursive: true });
  writeFileSync(
    join(at, "library.yaml"),
    `name: k7-core\nversion: ${v}\nrequires: ${requires}\n`,
  );
  writeFileSync(
    join(at, "modules", "audio", "verb", "module.yaml"),
    `plugin: ${plugin}\n`,
  );
}

const pins = () => readFileSync(join(ws, "_library-pins.yaml"), "utf8");

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
  mkdirSync(join(ws, "_modules", "audio", "my-verb"), { recursive: true });
  writeFileSync(
    join(ws, "_modules", "audio", "my-verb", "module.yaml"),
    'extends: "@k7-core/audio/verb"\n',
  );
  writeFileSync(join(ws, "_library-pins.yaml"), "k7-core: 1\n");
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
    expect(pins()).toBe("k7-core: 2\n");
    expect(logs).toEqual([
      "@k7-core: 1 → 2",
      "  _modules/audio/my-verb extends @k7-core/audio/verb, which changed",
    ]);
    expect(
      readFileSync(
        join(ws, "_modules", "audio", "my-verb", "module.yaml"),
        "utf8",
      ),
    ).toBe('extends: "@k7-core/audio/verb"\n');
  });

  it("refuses a version that needs a newer k7, and leaves the pin alone", async () => {
    await runCommand("library upgrade k7-core 3", host(), "cli");
    expect(refusals[0]).toMatch(/needs k7 level 99/);
    expect(pins()).toBe("k7-core: 1\n");
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
    expect(pins()).toBe("k7-core: 1\n");
  });

  it("lists what each library plays and what is ready", async () => {
    await runCommand("library versions", host(), "cli");
    expect(logs).toEqual([
      "@k7-core: plays 1; here 1, 2, 3 (needs level 99) — 2 is ready: library upgrade k7-core",
    ]);
  });
});
