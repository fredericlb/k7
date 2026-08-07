// completions.ts (yaml) — field-name and value completion, with the cursor's context from
// the lezer tree (keyPath.ts) and the vocabulary ASKED FOR rather than tabulated: which
// fields a module.yaml may carry is l8's business, not an editor's, so the caller
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

// A name carrying one of those, or a `: ` inside it, is only legal quoted — a value the user
// picked from the list must not be the thing that stops the file parsing. The LABEL stays
// bare: the quotes are punctuation, and showing them in the list would be showing YAML rather
// than names.
const quoteIfReserved = (label: string): string =>
  INDICATORS.includes(label[0] ?? "") ||
  label.includes(": ") ||
  label.endsWith(":")
    ? JSON.stringify(label)
    : label;

/**
 * Complete field names and values in a YAML document.
 *
 * The word being typed is matched by CodeMirror against the labels, so this only has to
 * say WHICH labels apply — which is the part that needed a 250-line scanner before.
 */
export function yamlCompletions(vocab: YamlVocabulary): CompletionSource {
  return (ctx) => {
    const at = cursorContext(ctx.state, ctx.pos);

    // On a `- ` item the key above introduced the LIST, so that is the field its scalars
    // belong to and the mapping holding it is the one above that. `entityValues` reads a
    // document by the same rule — `in: [melody, pad]` resolves like `track: melody`.
    const seqField = at.inSeqItem ? at.path[at.path.length - 1] : undefined;
    const fields = at.inKey ? vocab.fieldsAt(at.path) : [];
    // Such an item may still turn into a mapping (`- song: x`), so both vocabularies are
    // offered at once: nothing on the line has decided which it is.
    const values =
      (seqField !== undefined
        ? vocab.valuesAt?.(at.path.slice(0, -1), seqField)
        : at.valueOf
          ? vocab.valuesAt?.(at.path, at.valueOf)
          : []) ?? []; // free text — offering nothing beats offering noise
    if (!fields.length && !values.length) return null;

    // The token being typed: a bare word, or nothing (a fresh line, or just after `, `).
    // `@ / : .` are part of it, because a value can be one name — `@engine/audio/amp/nam`,
    // `synth:lead` — and a token stopping at the `@` would have CodeMirror replace only
    // its tail, completing `@engine/au` into `@engine/au@engine/audio/amp/nam`.
    const word = ctx.matchBefore(/[@A-Za-z_][\w\-./:]*$/);
    // …except where a value may carry SPACES. A song's folder is made from its tags, so
    // `AC-DC/Back in Black/Hells Bells` is ONE value; the word above stops at the last space,
    // and picking mid-phrase would splice the ref into the middle of itself. Only then, so
    // every other file keeps the token it has always had.
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
      // Same alphabet as the token: a stricter validFor closes the list on the first `/`.
      // Where a value may hold a space, the space is in it too, or the list would shut
      // halfway through a title.
      validFor: spacey ? /^[^:{}[\]]*$/ : /^[@\w\-./:]*$/,
    };
  };
}

/**
 * Where the value on the cursor's line begins, and whether a quote was already opened for it.
 *
 * Structural rather than lexical — past the `- ` of a sequence item, the `: ` of a mapping
 * entry, or the `[`/`{`/`,` of a flow collection — because that is the only way to know where
 * a value starts when the value itself may contain spaces.
 */
function valueSpan(
  state: EditorState,
  pos: number,
): { from: number; quoted: boolean } {
  const line = state.doc.lineAt(pos);
  const text = state.sliceDoc(line.from, pos);
  let start = 0;
  for (const m of text.matchAll(/^\s*-\s+|:\s+|[[{,]\s*/g))
    start = (m.index ?? 0) + m[0].length;
  // Only bites when nothing above matched — a fresh indented line — where taking the indent
  // as part of the token would have the pick eat it.
  while (text[start] === " " || text[start] === "\t") start++;
  const quoted = text[start] === '"' || text[start] === "'";
  return { from: line.from + start + (quoted ? 1 : 0), quoted };
}
