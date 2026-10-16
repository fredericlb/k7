// edit.ts — set or clear one field of a YAML file, in place. The FILE primitive; it
// knows nothing about modules or chains (that's packages/song-edit/src/projectEdit.ts). Uses the YAML
// Document API so the rest of the file comes back byte-identical, comments included.

import { isMap, isScalar, isSeq, parseDocument, Scalar } from "yaml";
import { wsExists, wsRead, wsWrite } from "./workspaceFile";

const read = (file: string) =>
  parseDocument(wsExists(file) ? wsRead(file) : "{}", {
    version: "1.2",
  });

const save = (file: string, doc: ReturnType<typeof parseDocument>): void =>
  wsWrite(file, doc.toString({ lineWidth: 0 }));

/** Set `path` in `file`, creating it and any intermediate maps. `value` goes through `createNode` so a later visitor (a timecode quoter) can see inside what was written. */
export function setFileValue(
  file: string,
  path: (string | number)[],
  value: unknown,
): void {
  const doc = read(file);
  const node = doc.createNode(value);
  // A list the author wrote INLINE stays inline, so a value change stays a one-line diff.
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
  wsWrite(
    file,
    withQuotedKeyMap(wsExists(file) ? wsRead(file) : "{}", path, map),
  );
}

/** The same edit on a TEXT, written by nobody: for a caller that writes several files only once all of them are made. */
export function withQuotedKeyMap(
  text: string,
  path: (string | number)[],
  map: Record<string, string>,
): string {
  const doc = parseDocument(text, { version: "1.2" });
  const node = doc.createNode(map);
  if (isMap(node))
    for (const pair of node.items)
      if (isScalar(pair.key)) pair.key.type = Scalar.QUOTE_DOUBLE;
  doc.setIn(path, node);
  return doc.toString({ lineWidth: 0 });
}
