// `project console` — what the settings' Project tab runs. Through the dispatcher and asserting
// the FILE, for the reason bypass.test.ts gives. See packages/song/docs/console.md.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { librariesFixture, writeDoc } from "@studio/song/testSupport";
import { wsData } from "@studio/song/yaml/workspaceDoc";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const SYS = "@k7-core/console/console-6";
let root: string;
let dir: string;
const logs: string[] = [];
let reloaded = 0;

beforeEach(() => {
  logs.length = 0;
  reloaded = 0;
  root = mkdtempSync(join(tmpdir(), "td-pconsole-"));
  dir = join(root, "song.k7");
  writeDoc(join(dir, "project.k7x"), { project: { name: "t" } });
  const lib = librariesFixture(root);
  for (const half of ["channel", "buss"])
    writeDoc(join(lib, "modules", "console", "console-6", half, "module.k7x"), {
      plugin: { type: "internal", name: `Console 6 ${half}` },
    });
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
  wsData(join(dir, "project.k7x")).project as { console?: string };

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
    await runCommand("project console @k7-core/console/nope", host(), "cli");
    expect(logs[0]).toMatch(/no console '@k7-core\/console\/nope'.*console-6/);
    expect(project().console).toBeUndefined();
    expect(reloaded).toBe(0);
  });

  it("lists the systems when given none", async () => {
    await runCommand("project console", host(), "cli");
    expect(logs).toEqual([`${SYS}  console-6`]);
  });
});
