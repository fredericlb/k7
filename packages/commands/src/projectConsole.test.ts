// `project console` — what the settings' Project tab runs. Through the dispatcher and asserting
// the FILE, for the reason bypass.test.ts gives. See packages/song/docs/console.md.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { librariesFixture } from "@studio/song/testSupport";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runCommand } from "./commandSpec";

const SYS = "@st0/console/console-6";
let root: string;
let dir: string;
const logs: string[] = [];
let reloaded = 0;

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  root = mkdtempSync(join(tmpdir(), "td-pconsole-"));
  dir = join(root, "song.st0");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.yaml"), "project:\n  name: t\n", "utf8");
  const lib = librariesFixture(root);
  for (const half of ["channel", "buss"]) {
    const at = join(lib, "modules", "console", "console-6", half);
    mkdirSync(at, { recursive: true });
    writeFileSync(
      join(at, "module.yaml"),
      `plugin: { type: internal, name: Console 6 ${half} }\n`,
      "utf8",
    );
  }
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const host = () =>
  ({
    songPath: dir,
    project: () => ({ tracks: [], groups: [], masterPlugins: [] }),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l),
    reload: () => {
      reloaded++;
    },
  }) as never;

const project = () =>
  parse(readFileSync(join(dir, "project.yaml"), "utf8")).project;

describe("project console", () => {
  it("writes the system and reloads", async () => {
    await runCommand(`project console ${SYS}`, host(), "cli");
    expect(project().console).toBe(SYS);
    expect(reloaded).toBe(1);
  });

  it("takes the key out on `none`", async () => {
    await runCommand(`project console ${SYS}`, host(), "cli");
    await runCommand("project console none", host(), "cli");
    expect(project().console).toBeUndefined();
  });

  it("refuses a system no library holds, and writes nothing", async () => {
    await runCommand("project console @st0/console/nope", host(), "cli");
    expect(logs[0]).toMatch(/no console '@st0\/console\/nope'.*console-6/);
    expect(project().console).toBeUndefined();
    expect(reloaded).toBe(0);
  });

  it("lists the systems when given none", async () => {
    await runCommand("project console", host(), "cli");
    expect(logs).toEqual([`${SYS}  console-6`]);
  });
});
