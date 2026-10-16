// yamlText.ts — the options every workspace YAML file is read and printed with, and the edit around them.
// A writer that prints at the default width instead is not drift to unify: it would refold files (docs/yamlText.md).

import { type Document, isSeq, parseDocument } from "yaml";

/** How a workspace file is parsed: YAML 1.2 forced, so `5:1:1` stays a string and a file declaring 1.1 cannot change that. */
export const YAML_READ = { version: "1.2" } as const;

/** The same, lenient on the errors the spec requires but the content does not need — the chain and module readers. */
export const YAML_READ_LENIENT = { version: "1.2", strict: false } as const;

/** How an edited file is printed: never folded, so a long value stays the one line its author wrote. */
export const YAML_WRITE = { lineWidth: 0 } as const;

export type YamlReadOptions = typeof YAML_READ | typeof YAML_READ_LENIENT;

/** A parsed workspace document, as every writer's helpers take it. */
export type YamlDoc = ReturnType<typeof parseDocument>;

/** Parse `text`, let `edit` change the document, print it back with YAML_WRITE. */
export function editYamlText(
  text: string,
  edit: (doc: YamlDoc) => void,
  read: YamlReadOptions = YAML_READ,
): string {
  const doc = parseDocument(text, read);
  edit(doc);
  return doc.toString(YAML_WRITE);
}

/** `doc.setIn` through `createNode`, a list the author wrote INLINE staying inline so a value change stays a one-line diff. */
export function setKeepingFlow(
  doc: Document,
  path: (string | number)[],
  value: unknown,
): void {
  const node = doc.createNode(value);
  const had = doc.getIn(path, true);
  if (isSeq(had) && had.flow && isSeq(node)) node.flow = true;
  doc.setIn(path, node);
}
