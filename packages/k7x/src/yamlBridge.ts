// yamlBridge.ts — lets code that speaks YAML read and write a .k7x file: read it as YAML, write YAML back as k7x edits.
// A reader would get wrong that a write reprints the file: only the DATA that changed is applied, as path edits (docs/bridge.md).

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { applyData } from "./applyData.ts";
import { parse, parseDocument } from "./edit.ts";
import { applySugared, type Sugar } from "./sugared.ts";

export type { Sugar };
export { applyData };

/** The YAML text of a k7x file, short forms expanded, for a reader that parses YAML; throws on a broken file. */
export function toYaml(k7x: string, sugar?: Sugar | null): string {
  const data = parse(k7x);
  return stringifyYaml(sugar ? sugar.expand(data) : data, { lineWidth: 0 });
}

/** The k7x text after a writer turned `toYaml`'s text into `yaml`; a short form whose expansion changed is written in full. */
export function applyYaml(
  k7x: string,
  yaml: string,
  sugar?: Sugar | null,
): string {
  const doc = parseDocument(k7x);
  applySugared(doc, parseYaml(yaml) ?? {}, sugar);
  return doc.toString();
}
