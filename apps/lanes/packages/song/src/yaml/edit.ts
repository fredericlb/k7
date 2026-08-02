// edit.ts — set or clear one field of a YAML file, in place. The FILE primitive; it
// knows nothing about modules or chains (that's ../projectEdit.ts). Uses the YAML
// Document API so the rest of the file comes back byte-identical, comments included.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";

const read = (file: string) =>
  parseDocument(existsSync(file) ? readFileSync(file, "utf8") : "{}", {
    version: "1.2",
  });

const save = (file: string, doc: ReturnType<typeof parseDocument>): void =>
  writeFileSync(file, doc.toString({ lineWidth: 0 }), "utf8");

/** Set `path` in `file`, creating it and any intermediate maps. `value` goes through `createNode` so a later visitor (a timecode quoter) can see inside what was written. */
export function setFileValue(
  file: string,
  path: (string | number)[],
  value: unknown,
): void {
  const doc = read(file);
  doc.setIn(path, doc.createNode(value));
  save(file, doc);
}

/** Remove `path` from `file`. A no-op when it isn't there. */
export function deleteFileValue(file: string, path: (string | number)[]): void {
  const doc = read(file);
  doc.deleteIn(path);
  save(file, doc);
}
