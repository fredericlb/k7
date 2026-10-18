// k7xMigrate.test.ts — a folder converted to .k7x: what converts, what is refused, what is kept, and that it compiles the same.

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateToK7x } from "./k7xMigrate";
import { loadProject } from "./project";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "k7x-migrate-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, text: string) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), text);
};

describe("migrateToK7x", () => {
  it("converts, keeps the original in the backup, and leaves what it may not touch", () => {
    put(
      "song.k7/project.yaml",
      "# the song\nproject:\n  name: demo\n  tempo: 120\n",
    );
    put("song.k7/nodes/a.yaml", "anchor: &x 1\nagain: *x\n");
    put("song.k7/graph.yaml", "modules: {}\n");
    put("song.k7/graph.k7x", "modules({})\n");
    put(".hidden/x.yaml", "a: 1\n");
    const backup = join(root, "..", `${basename(root)}-backup`);
    const report = migrateToK7x(root, { backup });
    expect(report.converted).toEqual(["song.k7/project.yaml"]);
    expect(report.shadowed).toEqual(["song.k7/graph.yaml"]);
    expect(report.refused).toEqual([
      {
        file: "song.k7/nodes/a.yaml",
        reason: "k7x: YAML anchors have no k7x form",
      },
    ]);
    expect(readFileSync(join(root, "song.k7/project.k7x"), "utf8")).toBe(
      '// the song\nproject({ name: "demo", tempo: 120 })\n',
    );
    expect(existsSync(join(root, "song.k7/project.yaml"))).toBe(false);
    expect(existsSync(join(backup, "song.k7/project.yaml"))).toBe(true);
    expect(existsSync(join(root, ".hidden/x.yaml"))).toBe(true);
    rmSync(backup, { recursive: true, force: true });
  });

  it("writes nothing on a dry run", () => {
    put("song.k7/project.yaml", "project:\n  name: demo\n");
    const report = migrateToK7x(root, { backup: null, dryRun: true });
    expect(report.converted).toEqual(["song.k7/project.yaml"]);
    expect(existsSync(join(root, "song.k7/project.k7x"))).toBe(false);
  });

  it("leaves every demo compiling to the same document", () => {
    const demos = join(import.meta.dirname, "..", "..", "..", "demos");
    cpSync(demos, root, { recursive: true });
    const names = ["synth-demo.k7", "node-demo.k7", "rack-demo.k7"];
    const before = names.map((n) => JSON.stringify(loadProject(join(root, n))));
    const report = migrateToK7x(root, { backup: null });
    expect(report.refused).toEqual([]);
    const after = names.map((n) => JSON.stringify(loadProject(join(root, n))));
    expect(after).toEqual(before);
  });
});
