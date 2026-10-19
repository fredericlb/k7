// k7xData.test.ts — a .k7x file read as data gives what its YAML used to parse back to, for every corpus file and every reader.
// A reader would get wrong what "the same" is: toStrictEqual, so an undefined key or a reordered one is a difference.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  parseModule,
  parseModuleData,
} from "@studio/song-schema/yaml/moduleFile";
import { parseUiData, parseUiFile } from "@studio/song-schema/yaml/uiFile";
import { YAML_READ } from "@studio/song-schema/yaml/yamlText";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { fromRaw, k7xData } from "./workspaceFile";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) return walk(abs);
    return name.endsWith(".k7x") ? [abs] : [];
  });
const files = ["demos", "k7-core"].flatMap((d) => walk(join(ROOT, d)));

describe(`a .k7x file read as data (${files.length} files)`, () => {
  it("has a corpus", () => expect(files.length).toBeGreaterThan(100));

  it.each(files.map((f) => [relative(ROOT, f), f]))("%s", (_, file) => {
    const raw = readFileSync(file, "utf8");
    let yaml: string;
    try {
      yaml = fromRaw(file, raw);
    } catch (e) {
      expect(() => k7xData(file, raw)).toThrow((e as Error).message);
      return;
    }
    const data = k7xData(file, raw);
    expect(data).toStrictEqual(parseYaml(yaml, YAML_READ));

    const viaText = parseModule(yaml);
    const viaData = parseModuleData(structuredClone(data));
    if (viaText.issues.length) expect(viaData).toBeUndefined();
    else expect(viaData).toStrictEqual(viaText);

    const uiText = parseUiFile(yaml);
    const uiData = parseUiData(structuredClone(data));
    if (uiText.issues.length) expect(uiData).toBeUndefined();
    else expect(uiData).toStrictEqual(uiText);
  });
});
