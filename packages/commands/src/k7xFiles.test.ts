// k7xFiles.test.ts — every demo, once as YAML and once with every file converted to .k7x: the same compile, before and after edits.
// The commands run on both copies must log the same and leave the same project, and a .k7x file must stay one.

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
import { fromYaml } from "@studio/k7x/from-yaml";
import { toYaml } from "@studio/k7x/yaml-bridge";
import { loadProject } from "@studio/song/project";
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

/** A copy of demos/; with `k7x`, every YAML file in it converted and the YAML removed. */
function copyDemos(k7x: boolean): string {
  const root = mkdtempSync(join(tmpdir(), k7x ? "k7x-demos-" : "yaml-demos-"));
  roots.push(root);
  cpSync(DEMOS, root, { recursive: true });
  // Whichever format demos/ is in, one copy is made all YAML and the other all k7x.
  for (const f of walk(root)) {
    if (k7x && /\.ya?ml$/.test(f)) {
      writeFileSync(
        f.replace(/\.ya?ml$/, ".k7x"),
        fromYaml(readFileSync(f, "utf8")),
      );
      rmSync(f);
    } else if (!k7x && /\.k7x$/.test(f)) {
      writeFileSync(
        f.replace(/\.k7x$/, ".yaml"),
        toYaml(readFileSync(f, "utf8")),
      );
      rmSync(f);
    }
  }
  return root;
}

const compiled = (root: string, name: string): string => {
  try {
    return JSON.stringify(loadProject(join(root, name))).replaceAll(
      root,
      "<root>",
    );
  } catch (e) {
    return `ERROR ${String((e as Error).message)
      .replaceAll(root, "<root>")
      .replaceAll(".k7x", ".yaml")}`;
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
  return logs.map((l) =>
    l.replaceAll(root, "<root>").replaceAll(".k7x", ".yaml"),
  );
}

const names = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => /\.(ya?ml|k7x)$/.test(f))
        .map((f) => f.replace(/\.(ya?ml|k7x)$/, ""))
        .sort()
    : [];

const yamlRoot = copyDemos(false);
const k7xRoot = copyDemos(true);
const demos = readdirSync(DEMOS).filter((d) => d.endsWith(".st0"));

describe("a workspace converted to .k7x", () => {
  it.each(demos)("%s compiles to the same document", (name) => {
    const yaml = compiled(yamlRoot, name);
    expect(yaml).not.toMatch(/^ERROR/);
    expect(compiled(k7xRoot, name)).toBe(yaml);
  });

  it.each(demos)("%s takes the same edits", async (name) => {
    const nodes = names(join(yamlRoot, name, "nodes"));
    const curves = names(join(yamlRoot, name, "curves"));
    const sequences = names(join(yamlRoot, name, "sequences"));
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
      const [a, b] = [
        await run(yamlRoot, name, line),
        await run(k7xRoot, name, line),
      ];
      expect(b, line).toEqual(a);
      if (process.env.K7X_TRACE)
        console.log(name, "|", line, "|", a.join(" / "));
      expect(compiled(k7xRoot, name), line).toBe(compiled(yamlRoot, name));
    }
    const strays = walk(join(k7xRoot, name)).filter(
      (f) => /\.ya?ml$/.test(f) && existsSync(f.replace(/\.ya?ml$/, ".k7x")),
    );
    expect(strays.map((f) => relative(k7xRoot, f))).toEqual([]);
  });

  it("reads the short forms as the data they stand for, and writes a changed note list in full", async () => {
    const name = "synth-demo.st0";
    // Fresh copies: the shared ones above have taken other edits already.
    const plain = copyDemos(false);
    const short = copyDemos(true);
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

  it("works on k7x alone once YAML is retired, and leaves a stray YAML file out", async () => {
    const name = "synth-demo.st0";
    const plain = copyDemos(false);
    const only = copyDemos(true);
    writeFileSync(
      join(only, name, "nodes", "ghost.yaml"),
      'extends: "@workspace/audio/compressor"\n',
    );
    // The YAML side first, while YAML is read: once retired, the YAML copy is no project at all.
    const line = "sequence note velocity melody 62 1 0.5";
    const before = compiled(plain, name);
    const log = await run(plain, name, line);
    const after = compiled(plain, name);
    process.env.STUDIO_K7X = "only";
    try {
      expect(compiled(plain, name)).toMatch(/^ERROR/);
      expect(compiled(only, name)).toBe(before);
      expect(await run(only, name, line)).toEqual(log);
      expect(compiled(only, name)).toBe(after);
      expect(compiled(only, name)).not.toContain("ghost");
    } finally {
      delete process.env.STUDIO_K7X;
    }
  });

  it("creates a new node as .k7x once k7x is everywhere, compiling as the YAML one does", async () => {
    const name = "synth-demo.st0";
    const line = "node new @workspace/audio/compressor squash";
    const a = await run(yamlRoot, name, line);
    process.env.STUDIO_K7X = "1";
    try {
      expect(await run(k7xRoot, name, line)).toEqual(a);
    } finally {
      delete process.env.STUDIO_K7X;
    }
    expect(existsSync(join(yamlRoot, name, "nodes", "squash.yaml"))).toBe(true);
    expect(existsSync(join(k7xRoot, name, "nodes", "squash.k7x"))).toBe(true);
    expect(existsSync(join(k7xRoot, name, "nodes", "squash.yaml"))).toBe(false);
    expect(compiled(k7xRoot, name)).toBe(compiled(yamlRoot, name));
  });
});
