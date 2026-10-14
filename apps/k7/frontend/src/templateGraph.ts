// templateGraph.ts — a library chain FILE drawn in the browser from its own text: one run from the
// input it is put after (`@in`) to `@out`. The server's graph verbs reach only a folder chain, so
// this drawing has no gestures — see docs/chainsBuilder.md.

import { parseChain } from "@studio/song-schema/yaml/chainFile";
import { isEndStep, itemsOf } from "@studio/song-schema/yaml/chainSchema";
import type { WebChainStep, WebGraph } from "./types";

/** Where the drawing says the template is fed from, and where it leaves — names only, as a card draws them. */
const IN = "@in";
const OUT = "@out";

/** The chain file's text as a one-chain graph, or the first reason it does not read. */
export function templateGraph(
  name: string,
  text: string,
): { graph: WebGraph } | { error: string } {
  const { value, issues } = parseChain(text);
  if (!value)
    return {
      error: issues
        .map(
          (i) =>
            `${i.line ? `${i.line}: ` : ""}${i.path ? `${i.path}: ` : ""}${i.message}`,
        )
        .join("; "),
    };
  const use: WebChainStep[] = value.steps
    .filter((s) => !isEndStep(s))
    .flatMap(itemsOf)
    .map((item) => {
      const ext = (item as { extends?: unknown }).extends;
      return {
        module: item.id,
        ...(typeof ext === "string" ? { uses: ext } : {}),
        ...(item.bypass ? { enabled: false } : {}),
      };
    });
  return {
    graph: {
      chains: { [name]: { from: IN, use, out: [{ to: OUT, gain: 1 }] } },
      tracks: [],
      warnings: [],
    },
  };
}
