// completions.ts (k7x) — the yaml mode's completion, over the same vocabulary, with the cursor read by k7x's own scan.
// Which keys and values apply is the schema's answer either way; only WHERE the cursor sits differs (docs/completion.md).

import type { Completion, CompletionSource } from "@codemirror/autocomplete";
import type { YamlVocabulary } from "../yaml/completions";
import { k7xCursor } from "./cursor";

/** Complete keys and values in a k7x document: a value is a string, so it is offered quoted unless typed inside quotes. */
export function k7xCompletions(vocab: YamlVocabulary): CompletionSource {
  return (ctx) => {
    const at = k7xCursor(ctx.state.sliceDoc(0, ctx.pos));
    const seqField = at.inSeqItem ? at.path[at.path.length - 1] : undefined;
    const fields = at.inKey && !at.inString ? vocab.fieldsAt(at.path) : [];
    const values =
      (seqField !== undefined
        ? vocab.valuesAt?.(at.path.slice(0, -1), seqField)
        : at.valueOf
          ? vocab.valuesAt?.(at.path, at.valueOf)
          : []) ?? [];
    if (!fields.length && !values.length) return null;

    if (at.inString) {
      const typed = ctx.matchBefore(/[^"'`]*$/);
      return {
        from: typed?.from ?? ctx.pos,
        options: values.map((label) => ({ label, type: "constant" })),
        validFor: /^[^"'`]*$/,
      };
    }
    const word = ctx.matchBefore(/[@A-Za-z_$][\w$\-./:]*$/);
    const options: Completion[] = [
      ...fields.map((label) => ({ label, type: "property" })),
      ...values.map((label) => ({
        label,
        type: "constant",
        apply: JSON.stringify(label),
      })),
    ];
    return {
      from: word?.from ?? ctx.pos,
      options,
      validFor: /^[@\w$\-./:]*$/,
    };
  };
}
