// yamlText.test.ts — the shared options print every corpus file exactly as the options each writer used to declare.
// A .k7x file is tested through its YAML view, the text a writer receives from the bridge (docs/yamlText.md).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { toYaml } from "@studio/k7x/yaml-bridge";
import { describe, expect, it } from "vitest";
import { isMap, isScalar, parse, parseDocument, stringify } from "yaml";
import { isDocFile } from "../docExt";
import { sugarFor } from "./sugar";
import {
  editYamlText,
  setKeepingFlow,
  YAML_READ,
  YAML_READ_LENIENT,
  YAML_WRITE,
} from "./yamlText";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const CORPORA = ["demos", "k7-core"]
  .map((d) => join(ROOT, d))
  .filter((d) => existsSync(d) && readdirSync(d).length > 0);

function docFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return docFiles(abs);
    return isDocFile(name) ? [abs] : [];
  });
}

const yamlText = (abs: string): string => {
  const raw = readFileSync(abs, "utf8");
  return abs.endsWith(".k7x") ? toYaml(raw, sugarFor(abs)) : raw;
};

// The spellings the writers declared before sharing these options, each kept verbatim.
const OLD_READS = [
  { version: "1.2" as const, lineWidth: 0 },
  { version: "1.2" as const },
];
const OLD_LENIENT = { version: "1.2" as const, strict: false };
const OLD_WRITE = { lineWidth: 0 };
const OLD_STRINGIFY = { lineWidth: 0, flowCollectionPadding: true };

/** The first top-level scalar key, to make one real edit with. */
function firstScalarKey(text: string): string | null {
  const doc = parseDocument(text, YAML_READ);
  if (!isMap(doc.contents)) return null;
  for (const pair of doc.contents.items)
    if (isScalar(pair.key) && isScalar(pair.value))
      return String(pair.key.value);
  return null;
}

describe("yamlText over the corpus", () => {
  const files = CORPORA.flatMap(docFiles);

  it("finds the corpus", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("prints every file byte for byte as the old options did, edited or not", () => {
    for (const abs of files) {
      const text = yamlText(abs);
      const key = firstScalarKey(text);
      const edit = (doc: ReturnType<typeof parseDocument>) => {
        if (key) doc.setIn([key], "changed");
      };
      for (const old of OLD_READS) {
        const a = parseDocument(text, old);
        edit(a);
        expect(editYamlText(text, edit), abs).toBe(a.toString(OLD_WRITE));
      }
      const b = parseDocument(text, OLD_LENIENT);
      edit(b);
      expect(editYamlText(text, edit, YAML_READ_LENIENT), abs).toBe(
        b.toString(OLD_WRITE),
      );
      const data = parse(text, YAML_READ);
      expect(stringify(data, YAML_WRITE), abs).toBe(
        stringify(data, OLD_STRINGIFY),
      );
    }
  });
});

describe("setKeepingFlow", () => {
  it("keeps an inline list inline and a block list block", () => {
    const text = "a: [1, 2]\nb:\n  - 1\n  - 2\n";
    const out = editYamlText(text, (doc) => {
      setKeepingFlow(doc, ["a"], [3, 4]);
      setKeepingFlow(doc, ["b"], [3, 4]);
    });
    expect(out).toBe("a: [ 3, 4 ]\nb:\n  - 3\n  - 4\n");
  });

  it("never folds a long value", () => {
    const long = "x".repeat(50).split("").join(" ");
    const out = editYamlText("k: 1\n", (doc) => doc.setIn(["k"], long));
    expect(out).toBe(`k: ${long}\n`);
  });
});
