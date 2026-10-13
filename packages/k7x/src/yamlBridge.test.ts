// yamlBridge.test.ts — a YAML writer's edit, made on toYaml's text, lands in the k7x file as that edit and nothing more.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml, parseDocument as parseYamlDoc } from "yaml";
import { parse } from "./edit.ts";
import { fromYaml } from "./fromYaml.ts";
import { applyYaml, toYaml } from "./yamlBridge.ts";

const writer = (
  k7x: string,
  edit: (d: ReturnType<typeof parseYamlDoc>) => void,
): string => {
  const d = parseYamlDoc(toYaml(k7x));
  edit(d);
  return applyYaml(k7x, d.toString());
};

const NOTES = `// the melody
notes([
  t(0).d(1).k(60),
  t(1).d(1).k(62), // the second
  t(2).d(1).k(64),
])
`;

describe("the YAML bridge", () => {
  it("reads a k7x file as YAML with the same data", () => {
    expect(parseYaml(toYaml(NOTES))).toEqual(parse(NOTES));
  });

  it("applies a changed leaf in place, comments kept", () => {
    expect(writer(NOTES, (d) => d.setIn(["notes", 1, "k"], 63))).toBe(
      NOTES.replace("k(62)", "k(63)"),
    );
  });

  it("applies an inserted list item as one new line", () => {
    const out = writer(NOTES, (d) => {
      const seq = d.get("notes") as { items: unknown[] };
      seq.items.splice(1, 0, d.createNode({ t: 0.5, d: 1, k: 61 }));
    });
    expect(out).toBe(NOTES.replace("  t(1)", "  t(0.5).d(1).k(61),\n  t(1)"));
  });

  it("applies a removed list item as its line gone", () => {
    expect(writer(NOTES, (d) => d.deleteIn(["notes", 2]))).toBe(
      NOTES.replace("  t(2).d(1).k(64),\n", ""),
    );
  });

  it("applies added and removed keys", () => {
    const out = writer('project({ name: "a", tempo: 120 })\n', (d) => {
      d.deleteIn(["project", "name"]);
      d.setIn(["project", "video"], false);
      d.setIn(["markers"], {});
    });
    expect(out).toBe("project({ tempo: 120, video: false })\nmarkers({})\n");
  });

  it("changes nothing when the writer changed nothing", () => {
    expect(writer(NOTES, () => {})).toBe(NOTES);
  });
});

const ROOT = join(import.meta.dirname, "..", "..", "..");
const yamlFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const abs = join(dir, n);
    return statSync(abs).isDirectory()
      ? yamlFiles(abs)
      : /\.ya?ml$/.test(n)
        ? [abs]
        : [];
  });
const files = ["demos", "st0-library"]
  .map((d) => join(ROOT, d))
  .filter(existsSync)
  .flatMap(yamlFiles);
const PER_FILE = 25;

describe.runIf(files.length > 0)(
  `the bridge over the corpus (${files.length} files)`,
  () => {
    it.each(files.map((f) => [relative(ROOT, f), f]))("%s", (_, file) => {
      const k7x = fromYaml(readFileSync(file, "utf8"));
      const data = parse(k7x);
      expect(parseYaml(toYaml(k7x))).toEqual(data);

      const leaves: (string | number)[][] = [];
      const walk = (v: unknown, at: (string | number)[]) => {
        if (leaves.length >= PER_FILE) return;
        if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...at, i]));
        else if (v !== null && typeof v === "object")
          for (const [k, x] of Object.entries(v)) walk(x, [...at, k]);
        else leaves.push(at);
      };
      walk(data, []);

      for (const path of leaves) {
        const out = writer(k7x, (d) => {
          const v = d.getIn(path);
          d.setIn(
            path,
            typeof v === "number"
              ? v + 1
              : typeof v === "boolean"
                ? !v
                : `${v}x`,
          );
        });
        const [was, now] = [k7x.split("\n"), out.split("\n")];
        const changed = now.filter((l, i) => l !== was[i]);
        expect(now.length).toBe(was.length);
        expect(changed.length).toBeLessThanOrEqual(1);
      }
    });
  },
);
