// completions.ts (yaml) — field-name and value completion, with the cursor's context from
// the lezer tree (keyPath.ts) and the vocabulary ASKED FOR rather than tabulated: which
// fields a module.yaml may carry is k7's business, not an editor's, so the caller
// passes fieldsAt/valuesAt (derived from the Zod schemas, so they cannot drift).

import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import type { EditorState } from "@codemirror/state";
import { cursorContext } from "./keyPath";

export interface YamlVocabulary {
  /** The field names allowed in the mapping at `path`. */
  fieldsAt: (path: string[]) => string[];
  /** The values allowed for `field` in the mapping at `path`. Empty for free text. */
  valuesAt?: (path: string[], field: string) => string[];
}

/** The characters YAML gives a meaning to at the START of a plain scalar. */
const INDICATORS = "-?:,[]{}#&*!|>'\"%@`";

// A name carrying one of those is only legal quoted, and the LABEL stays bare — see docs/completion.md.
const quoteIfReserved = (label: string): string =>
  INDICATORS.includes(label[0] ?? "") ||
  label.includes(": ") ||
  label.endsWith(":")
    ? JSON.stringify(label)
    : label;

/** Complete field names and values in a YAML document: CodeMirror matches the word, this says WHICH labels apply. */
export function yamlCompletions(vocab: YamlVocabulary): CompletionSource {
  return (ctx) => {
    const at = cursorContext(ctx.state, ctx.pos);

    // On a `- ` item the key above introduced the LIST, which is the rule `entityValues` reads documents by.
    const seqField = at.inSeqItem ? at.path[at.path.length - 1] : undefined;
    const fields = at.inKey ? vocab.fieldsAt(at.path) : [];

    // Such an item may still turn into a mapping, so both vocabularies are offered at once.
    const values =
      (seqField !== undefined
        ? vocab.valuesAt?.(at.path.slice(0, -1), seqField)
        : at.valueOf
          ? vocab.valuesAt?.(at.path, at.valueOf)
          : []) ?? []; // free text — offering nothing beats offering noise
    if (!fields.length && !values.length) return null;

    // The token being typed, `@ / : .` included, since a value can be one name like `@engine/audio/amp/nam`.
    const word = ctx.matchBefore(/[@A-Za-z_][\w\-./:]*$/);

    // …except where a value may carry SPACES, and only then, so every other file keeps its token — docs/completion.md.
    const spacey = values.some((v) => v.includes(" "));
    const span = spacey ? valueSpan(ctx.state, ctx.pos) : null;
    const from = span ? span.from : (word?.from ?? ctx.pos);
    // Inside quotes the user (or closeBrackets) already opened, adding our own would nest them.
    const inQuotes = span
      ? span.quoted
      : from > 0 && /^["']/.test(ctx.state.sliceDoc(from - 1, from));

    const options: Completion[] = [
      ...fields.map((label) => ({ label, type: "property" })),
      ...values.map((label) => ({
        label,
        type: "constant",
        apply: inQuotes ? undefined : quoteIfReserved(label),
      })),
    ];
    return {
      from,
      options,
      // Same alphabet as the token, space included where a value may hold one, or the list shuts mid-title.
      validFor: spacey ? /^[^:{}[\]]*$/ : /^[@\w\-./:]*$/,
    };
  };
}

/** Where the value on the cursor's line begins, structurally rather than lexically — see docs/completion.md. */
function valueSpan(
  state: EditorState,
  pos: number,
): { from: number; quoted: boolean } {
  const line = state.doc.lineAt(pos);
  const text = state.sliceDoc(line.from, pos);
  let start = 0;
  for (const m of text.matchAll(/^\s*-\s+|:\s+|[[{,]\s*/g))
    start = (m.index ?? 0) + m[0].length;
  // Only bites on a fresh indented line, where taking the indent as part of the token would have the pick eat it.
  while (text[start] === " " || text[start] === "\t") start++;
  const quoted = text[start] === '"' || text[start] === "'";
  return { from: line.from + start + (quoted ? 1 : 0), quoted };
}
