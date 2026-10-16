// edit.ts — set or clear one field of a YAML file, in place. The FILE primitive; it
// knows nothing about modules or chains (that's packages/song-edit/src/projectEdit.ts). Uses the YAML
// Document API so the rest of the file comes back byte-identical, comments included.

import {
  editYamlText,
  setKeepingFlow,
} from "@studio/song-schema/yaml/yamlText";
import { isMap, isScalar, Scalar } from "yaml";
import { wsExists, wsRead, wsWrite } from "./workspaceFile";

const textOf = (file: string): string => (wsExists(file) ? wsRead(file) : "{}");

/** Set `path` in `file`, creating it and any intermediate maps. `value` goes through `createNode` so a later visitor (a timecode quoter) can see inside what was written. */
export function setFileValue(
  file: string,
  path: (string | number)[],
  value: unknown,
): void {
  wsWrite(
    file,
    editYamlText(textOf(file), (doc) => setKeepingFlow(doc, path, value)),
  );
}

/** Remove `path` from `file`. A no-op when it isn't there. */
export function deleteFileValue(file: string, path: (string | number)[]): void {
  wsWrite(
    file,
    editYamlText(textOf(file), (doc) => {
      doc.deleteIn(path);
    }),
  );
}

/** Set a MAP whose keys must be QUOTED — the markers, where a timecode is a key (docs/timecode.md). */
export function setQuotedKeyMap(
  file: string,
  path: (string | number)[],
  map: Record<string, string>,
): void {
  wsWrite(file, withQuotedKeyMap(textOf(file), path, map));
}

/** The same edit on a TEXT, written by nobody: for a caller that writes several files only once all of them are made. */
export function withQuotedKeyMap(
  text: string,
  path: (string | number)[],
  map: Record<string, string>,
): string {
  return editYamlText(text, (doc) => {
    const node = doc.createNode(map);
    if (isMap(node))
      for (const pair of node.items)
        if (isScalar(pair.key)) pair.key.type = Scalar.QUOTE_DOUBLE;
    doc.setIn(path, node);
  });
}
