// nodeStack.ts — `node stack <node> <new node>`: the bottom `+` under a card, in a chain project. The
// new node goes right under the one above, both in a subchain run in that one's place — or into the
// subchain it already sits in. See packages/song/docs/chainFiles.md, "Subchains".

import { chainNodeName } from "@studio/song/chainGraphEdit";
import { isChainProject } from "@studio/song/chainProject";
import { stackChainNode } from "@studio/song/chainStack";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitWords } from "./shared.ts";

export const NODE_STACK_VERBS: Record<string, SidHandler> = {
  "node.stack": (a, h) => stackNode(a, h),
};

async function stackNode(arg: string, h: CommandHost): Promise<void> {
  const parts = splitWords(arg);
  if (parts.length < 2) {
    h.refuse([
      "usage: node stack <node> <new node> (the new node goes right under the first, in one subchain)",
    ]);
    return;
  }
  if (!isChainProject(h.songPath)) {
    h.refuse([
      "node stack: a stack is a subchain, and only a chain project has them (packages/song/docs/chainFiles.md)",
    ]);
    return;
  }
  // A node `node new` just made answers to the name it was given as well as to its id.
  const [above, node] = parts.map((p) => chainNodeName(h.songPath, p));
  try {
    const written = stackChainNode(h.songPath, above, node);
    await h.reload();
    h.log([`stacked ${node} under ${above} (${written.join(", ")})`]);
  } catch (e) {
    h.refuse([`node stack: ${(e as Error).message}`]);
  }
}
