// chainsVocabulary.ts — what a segment in a médiathèque chain may point AT, read off the
// template itself. Its own adapter rather than `schemaVocabulary`'s hints, which describe a
// l8 project: a template's nodes are the instances beside it, and the file names them all.
// See ../docs/completion.md.

import { CHAIN_OUT } from "@studio/song/chainsGraph";
import { parseChains } from "@studio/song/yaml/chainsFile";
import type { YamlVocabulary } from "@studio/ui-editor/yaml/completions";
import { schemaVocabulary } from "@studio/ui-editor/yaml/vocabulary";

/**
 * The nodes a template declares — the keys of `modules:` — or null when the text does not
 * parse.
 *
 * Null and not an empty list, so a caller can keep the last readable set: half-typed YAML
 * fails to parse on nearly every keystroke, and a vocabulary that emptied itself each time
 * would offer nothing exactly while you are typing the line that needs it. `ChainView` beside
 * it holds its drawing the same way.
 *
 * The keys and not the `instances/` folder because only the frontend is asking: a listing
 * carries a chain's instance COUNT and not their names, and a node has to be declared here to
 * be in the graph at all.
 */
export function chainNodes(text: string): string[] | null {
  const parsed = parseChains(text);
  if (!parsed.value) return null;
  return Object.keys(parsed.value.modules ?? {});
}

/**
 * The vocabulary for a chains.yaml, over the nodes last read from it.
 *
 * Fields still come from the schema — the file's three sections are the schema's business, and
 * `fileKindFor` recognises this file — so only the values are answered here.
 */
export function chainsVocabulary(
  path: string,
  nodes: string[] | null,
): YamlVocabulary {
  const base = schemaVocabulary(path);
  const declared = nodes ?? [];
  // A destination may also leave the template: `@out` is where its signal goes when nothing
  // else takes it. `@in` is not offered — it is where a run STARTS, and nothing feeds it.
  const dests = [...new Set([...declared, CHAIN_OUT])];
  return {
    fieldsAt: base.fieldsAt,
    valuesAt: (keyPath, field) => {
      // Under `modules:` the "field" is a NODE's own name and the values are its destinations —
      // positional, exactly as l8's hints are for the same file. One map: a lane is a module too
      // (packages/song/docs/trackModules.md), and a template's `@in` is in it like the rest.
      if (keyPath[0] === "modules") return dests;
      // What the signal passes through untouched: a module and nothing else. `@out` is not
      // one — a sink has nothing to bypass.
      if (field === "bypassed" || keyPath[0] === "bypassed") return declared;
      return [];
    },
  };
}
