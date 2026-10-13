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
});
