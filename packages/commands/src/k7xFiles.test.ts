// k7xFiles.test.ts — every demo as the k7x workspace it is: it compiles, and keeps compiling through a run of edits.
// The short forms read as the data they stand for, a stray .yaml file is never read, and a new node is a .k7x file.

import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { loadProject } from "@studio/song/project";
import { isDocFile, stripDocExt } from "@studio/song-schema/docExt";
import { afterAll, describe, expect, it } from "vitest";
import { runCommand } from "./commandSpec";

const DEMOS = join(import.meta.dirname, "..", "..", "..", "demos");
const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const abs = join(dir, n);
    return statSync(abs).isDirectory() ? walk(abs) : [abs];
  });
}

/** A fresh copy of demos/, removed after the suite. */
function copyDemos(): string {
  const root = mkdtempSync(join(tmpdir(), "k7x-demos-"));
  roots.push(root);
  cpSync(DEMOS, root, { recursive: true });
  return root;
}

const compiled = (root: string, name: string): string => {
  try {
    // JSON doubles a Windows path's backslashes, so the root is matched as JSON spells it.
    return JSON.stringify(loadProject(join(root, name))).replaceAll(
      JSON.stringify(root).slice(1, -1),
      "<root>",
    );
  } catch (e) {
    return `ERROR ${String((e as Error).message).replaceAll(root, "<root>")}`;
  }
};

async function run(
  root: string,
  name: string,
  line: string,
): Promise<string[]> {
  const logs: string[] = [];
  const host = {
    songPath: join(root, name),
    project: () => loadProject(join(root, name)),
    baseModules: [],
    log: (l: string[]) => logs.push(...l),
    refuse: (l: string[]) => logs.push(...l.map((x) => `refused: ${x}`)),
    reload: () => {},
    showNativePluginUI: () => {},
  } as never;
  try {
    await runCommand(line, host, "cli");
  } catch (e) {
    logs.push(`threw: ${(e as Error).message}`);
  }
  return logs.map((l) => l.replaceAll(root, "<root>"));
}

const names = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir).filter(isDocFile).map(stripDocExt).sort()
    : [];

const yamlFiles = (dir: string): string[] =>
  walk(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((f) => relative(dir, f));

const shared = copyDemos();
const demos = readdirSync(DEMOS).filter((d) => d.endsWith(".k7"));

describe("the demos as k7x workspaces", () => {
  it.each(demos)("%s compiles", (name) => {
    expect(compiled(shared, name)).not.toMatch(/^ERROR/);
  });

  it("ship no YAML file, a backup included, since every Examples workspace is mirrored from them", () => {
    const yaml = walk(DEMOS)
      .map((f) => relative(DEMOS, f))
      .filter((f) => /\.ya?ml(\.|$)/i.test(f));
    expect(yaml).toEqual([]);
  });

  it.each(demos)("%s takes a run of edits and still compiles", async (name) => {
    const dir = join(shared, name);
    const before = yamlFiles(dir);
    const nodes = names(join(dir, "nodes"));
    const curves = names(join(dir, "curves"));
    const sequences = names(join(dir, "sequences"));
    const lines = [
      "project tag demo",
      "project aspect 16:9",
      ...nodes.slice(0, 3).map((n) => `events move ${n} 1:1 99:1 +1:0`),
      ...sequences.map((s) => `sequence note velocity ${s} 60 0 0.9`),
      ...nodes
        .slice(0, 2)
        .flatMap((n) => [`node bypass ${n} on`, `node bypass ${n} off`]),
      ...curves.flatMap((c) => [
        `curve point add ${c} 3:1:1 0.5`,
        `curve point move ${c} 3:1:1 4:1:1 0.25`,
      ]),
      ...nodes.slice(2, 3).map((n) => `node delete ${n}`),
    ];
    for (const line of lines) {
      const log = await run(shared, name, line);
      if (process.env.K7X_TRACE)
        console.log(name, "|", line, "|", log.join(" / "));
      expect(
        log.filter((l) => l.startsWith("threw:")),
        line,
      ).toEqual([]);
      expect(compiled(shared, name), line).not.toMatch(/^ERROR/);
    }
    // No edit writes a YAML file into a workspace.
    expect(yamlFiles(dir)).toEqual(before);
  });

  it("reads the short forms as the data they stand for, and writes a changed note list in full", async () => {
    const name = "synth-demo.k7";
    // Fresh copies: the shared one above has taken other edits already.
    const plain = copyDemos();
    const short = copyDemos();
    writeFileSync(
      join(short, name, "sequences", "melody.k7x"),
      'notes("c4 d4 e4 f4 g4 a4 b4 c5")\n',
    );
    writeFileSync(
      join(short, name, "graph.k7x"),
      'runs([["melody", "lead", "MIX", "OUT"], ["pad#midi", "synth-pad", "MIX"]])\n',
    );
    expect(compiled(short, name)).toBe(compiled(plain, name));
    const line = "sequence note velocity melody 62 1 0.5";
    expect(await run(short, name, line)).toEqual(await run(plain, name, line));
    const melody = readFileSync(
      join(short, name, "sequences", "melody.k7x"),
      "utf8",
    );
    expect(melody).not.toContain('notes("');
    expect(melody).toContain("t(1).d(1).k(62).v(0.5)");
    expect(compiled(short, name)).toBe(compiled(plain, name));
    expect(readFileSync(join(short, name, "graph.k7x"), "utf8")).toContain(
      "runs(",
    );
  });

  it("leaves a stray YAML file out of the project, and out of an edit", async () => {
    const name = "synth-demo.k7";
    const plain = copyDemos();
    const stray = copyDemos();
    const ghost = join(stray, name, "nodes", "ghost.yaml");
    const text = 'extends: "@workspace/audio/compressor"\n';
    writeFileSync(ghost, text);
    expect(compiled(stray, name)).toBe(compiled(plain, name));
    const line = "sequence note velocity melody 62 1 0.5";
    expect(await run(stray, name, line)).toEqual(await run(plain, name, line));
    expect(compiled(stray, name)).toBe(compiled(plain, name));
    expect(compiled(stray, name)).not.toContain("ghost");
    expect(readFileSync(ghost, "utf8")).toBe(text);
  });

  it("creates a new node as .k7x, and the project still compiles", async () => {
    const name = "synth-demo.k7";
    const root = copyDemos();
    const log = await run(
      root,
      name,
      "node new @workspace/audio/compressor squash",
    );
    expect(log.filter((l) => /^(threw|refused):/.test(l))).toEqual([]);
    expect(existsSync(join(root, name, "nodes", "squash.k7x"))).toBe(true);
    expect(existsSync(join(root, name, "nodes", "squash.yaml"))).toBe(false);
    expect(compiled(root, name)).not.toMatch(/^ERROR/);
  });
});
