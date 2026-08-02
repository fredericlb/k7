// completions.ts (yaml) — field-name and value completion, with the cursor's context from
// the lezer tree (keyPath.ts) and the vocabulary ASKED FOR rather than tabulated: which
// fields a module.yaml may carry is lanes's business, not an editor's, so the caller
// passes fieldsAt/valuesAt (derived from the Zod schemas, so they cannot drift).

import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import { cursorContext } from "./keyPath";

export interface YamlVocabulary {
  /** The field names allowed in the mapping at `path`. */
  fieldsAt: (path: string[]) => string[];
  /** The values allowed for `field` in the mapping at `path`. Empty for free text. */
  valuesAt?: (path: string[], field: string) => string[];
}

const options = (
  labels: string[],
  type: string,
  apply?: (label: string) => string,
): Completion[] =>
  labels.map((label) => ({ label, type, apply: apply?.(label) }));

// YAML reserves `@` and a backtick as the first character of a plain scalar, so a module
// ref (`@engine/audio/amp/nam`) is only legal quoted — a value the user picked from the
// list must not be the thing that stops the file parsing. The LABEL stays bare: the quotes
// are punctuation, and showing them in the list would be showing YAML, not module names.
const quoteIfReserved = (label: string): string =>
  /^[@`]/.test(label) ? `"${label}"` : label;

/**
 * Complete field names and values in a YAML document.
 *
 * The word being typed is matched by CodeMirror against the labels, so this only has to
 * say WHICH labels apply — which is the part that needed a 250-line scanner before.
 */
export function yamlCompletions(vocab: YamlVocabulary): CompletionSource {
  return (ctx) => {
    const at = cursorContext(ctx.state, ctx.pos);
    // The token being typed: a bare word, or nothing (a fresh line, or just after `, `).
    // `@ / : .` are part of it, because a value can be one name — `@engine/audio/amp/nam`,
    // `synth:lead` — and a token stopping at the `@` would have CodeMirror replace only
    // its tail, completing `@engine/au` into `@engine/au@engine/audio/amp/nam`.
    const word = ctx.matchBefore(/[@A-Za-z_][\w\-./:]*$/);
    const from = word ? word.from : ctx.pos;

    if (at.inKey) {
      const fields = vocab.fieldsAt(at.path);
      if (!fields.length) return null;
      return {
        from,
        options: options(fields, "property"),
        validFor: /^[\w-]*$/,
      };
    }

    if (!at.valueOf || !vocab.valuesAt) return null;
    const values = vocab.valuesAt(at.path, at.valueOf);
    if (!values.length) return null; // free text — offering nothing beats offering noise
    // Inside quotes the user (or closeBrackets) already opened, adding our own would nest them.
    const inQuotes =
      from > 0 && /^["']/.test(ctx.state.sliceDoc(from - 1, from));
    return {
      from,
      options: options(
        values,
        "constant",
        inQuotes ? undefined : quoteIfReserved,
      ),
      // Same alphabet as the token: a stricter validFor closes the list on the first `/`.
      validFor: /^[@\w\-./:]*$/,
    };
  };
}
