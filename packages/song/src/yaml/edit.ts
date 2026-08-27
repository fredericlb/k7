// edit.ts — set or clear one field of a YAML file, in place. The FILE primitive; it
// knows nothing about modules or chains (that's ../projectEdit.ts). Uses the YAML
// Document API so the rest of the file comes back byte-identical, comments included.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isMap, isScalar, isSeq, parseDocument, Scalar } from "yaml";

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
  const node = doc.createNode(value);
  // A list the author wrote INLINE stays inline. `createNode` always builds a block sequence, so
  // writing `viewport: [1280, 720, 30]` turned one line into four — churn in a file whose whole
  // point is that a value change is a one-line diff. The author's style is the file's.
  const had = doc.getIn(path, true);
  if (isSeq(had) && had.flow && isSeq(node)) node.flow = true;
  doc.setIn(path, node);
  save(file, doc);
}

/** Remove `path` from `file`. A no-op when it isn't there. */
export function deleteFileValue(file: string, path: (string | number)[]): void {
  const doc = read(file);
  doc.deleteIn(path);
  save(file, doc);
}

/** Set a MAP whose keys must be QUOTED — the markers, where a timecode is a key (docs/timecode.md). */
export function setQuotedKeyMap(
  file: string,
  path: (string | number)[],
  map: Record<string, string>,
): void {
  const doc = read(file);
  const node = doc.createNode(map);
  if (isMap(node))
    for (const pair of node.items)
      if (isScalar(pair.key)) pair.key.type = Scalar.QUOTE_DOUBLE;
  doc.setIn(path, node);
  save(file, doc);
}
