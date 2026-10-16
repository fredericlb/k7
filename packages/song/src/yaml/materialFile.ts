// materialFile.ts — READ the window a material file states. Nothing writes one: a clip file
// describes the bytes and a placement describes the use, so the window lives on the event
// (song/docs/materialCut.md). This is the reader the resize consults for its bound.

import { YAML_READ } from "@studio/song-schema/yaml/yamlText";
import { parseDocument } from "yaml";
import { wsRead } from "./workspaceFile";

/** A window edge as the file spells it: seconds into a source (a number), or a position in a sequence. */
export type WindowValue = number | string;

/** The window a material file already declares, as authored (absent stays absent). */
export function materialWindowOf(file: string): {
  from?: WindowValue;
  to?: WindowValue;
} {
  const doc = parseDocument(wsRead(file), YAML_READ);
  const one = (k: string): WindowValue | undefined => {
    const v = doc.getIn([k]);
    return typeof v === "number" || typeof v === "string" ? v : undefined;
  };
  return { from: one("from"), to: one("to") };
}
