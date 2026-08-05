// materialFile.ts — write the WINDOW (`from`/`to`) on a clip or sequence file, in place.
// The file primitive behind a resize: the extent of an event lives on its material, not on
// the placement (see trackSchema's PlacementSchema and song/docs/clipResize.md).

import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";
import { quoteTimecodes } from "./trackFile";

const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

/** A window edge as the file spells it: seconds into a source (a number), or a position in a sequence. */
export type WindowValue = number | string;

/**
 * Set `from`/`to` on the material at `file`.
 *
 * A `from` of 0 is DELETED rather than written: absent means "the material's start", and a
 * file full of zeroes makes "not trimmed" and "trimmed to the beginning" read alike — the
 * same rule the compiler follows when it leaves them off the doc.
 *
 * Timecodes are re-quoted on the way out, because `to: 3:1` unquoted is sexagesimal in YAML
 * 1.1 and would silently become beat 181.
 */
export function setMaterialWindow(
  file: string,
  from: WindowValue,
  to: WindowValue,
): void {
  const doc = parseDocument(readFileSync(file, "utf8"), OPTS);
  if (from === 0 || from === "") doc.deleteIn(["from"]);
  else doc.setIn(["from"], doc.createNode(from));
  doc.setIn(["to"], doc.createNode(to));
  quoteTimecodes(doc);
  writeFileSync(file, doc.toString(OUT), "utf8");
}

/** The window a material file already declares, as authored (absent stays absent). */
export function materialWindowOf(file: string): {
  from?: WindowValue;
  to?: WindowValue;
} {
  const doc = parseDocument(readFileSync(file, "utf8"), OPTS);
  const one = (k: string): WindowValue | undefined => {
    const v = doc.getIn([k]);
    return typeof v === "number" || typeof v === "string" ? v : undefined;
  };
  return { from: one("from"), to: one("to") };
}
