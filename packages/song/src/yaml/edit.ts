// edit.ts — set or clear one field of a YAML file, in place. The FILE primitive; it
// knows nothing about modules or chains (that's ../projectEdit.ts). Uses the YAML
// Document API so the rest of the file comes back byte-identical, comments included.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isMap, isScalar, parseDocument, Scalar } from "yaml";

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

/**
 * Set a MAP whose keys must be written quoted — the markers, and nothing else so far.
 *
 * `setFileValue` cannot do this: it takes a plain object and `createNode` gives every key the
 * plain style, which under YAML 1.2 is correct and under 1.1 is a disaster. `2:1:1` unquoted is a
 * sexagesimal integer there, and a marker map is the one place in the model where a TIMECODE is a
 * key rather than a value — so `quoteTimecodes`, which walks values under known keys, cannot see
 * it either.
 *
 * `writeMarkers` has carried the comment "Keys are QUOTED" since it was written, and did not
 * quote them. This is that comment, implemented.
 */
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
