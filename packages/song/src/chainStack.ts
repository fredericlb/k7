// chainStack.ts — STACK a loose node under another in a chain project: the two become a subchain run
// in place of the one above (`{ sub }`), or the new one joins the subchain that one already sits in.
// The one thing a reader would get wrong: the new node must be LOOSE — alone in its chain, wired to
// nothing — which is what `node new` leaves; its chain file goes, its item moves. docs/chainFiles.md.

import { rmSync } from "node:fs";
import { relative } from "node:path";
import { formatChain, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  CHAIN_SINKS,
  type ChainFile,
  type Item,
  itemsOf,
  LAYOUT_FILE,
} from "@studio/song-schema/yaml/chainSchema";
import {
  chainFilePath,
  readChainProject,
  readLayout,
  writeLayout,
} from "./chainProject";
import { wsWriteText } from "./yaml/workspaceDoc";

const SINKS = new Set<string>(CHAIN_SINKS);

/** A free subchain id inside `c`, after what the node above extends. */
function freeId(c: ChainFile, item: Item): string {
  const ext = (item as { extends?: unknown }).extends;
  const base =
    typeof ext === "string" ? (ext.split("/").pop() ?? item.id) : item.id;
  const taken = new Set((c.subchains ?? []).map((sc) => sc.id));
  let id = base;
  for (let i = 2; taken.has(id) || SINKS.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Put loose node `node` right under `above`, in one subchain with it; the project-relative files written. */
export function stackChainNode(
  dir: string,
  above: string,
  node: string,
): string[] {
  const cp = readChainProject(dir);
  if (cp.issues.length)
    throw new Error(
      `the chains do not read — fix them first:\n  ${cp.issues.join("\n  ")}`,
    );
  const at = cp.nodes[above];
  if (!at) throw new Error(`no node '${above}' in this project`);
  if (at.track)
    throw new Error(`'${above}' is a lane, a source: nothing stacks under it`);
  if (at.item !== null)
    throw new Error(
      `'${above}' sits in a side-by-side step — stack under a node standing alone`,
    );
  const born = cp.nodes[node];
  if (!born) throw new Error(`no node '${node}' in this project`);
  const own = cp.chains[born.chain];
  const loose =
    !born.sub &&
    born.chain !== at.chain &&
    !own.subchains?.length &&
    own.steps.length === 1 &&
    itemsOf(own.steps[0]).length === 1;
  if (!loose)
    throw new Error(
      `'${node}' is already wired — only a node \`node new\` just made can be stacked`,
    );

  const parent = structuredClone(cp.chains[at.chain]);
  const item = structuredClone(born.value);
  if (at.sub) {
    // Already in a subchain: the new node joins it, right under the one above.
    const sc = parent.subchains?.find((s) => s.id === at.sub);
    sc?.steps.splice(at.step + 1, 0, item);
  } else {
    const id = freeId(parent, at.value);
    parent.steps[at.step] = { sub: id };
    parent.subchains = [
      ...(parent.subchains ?? []),
      { id, steps: [at.value, item] },
    ];
  }
  const text = formatChain(parent, cp.texts[at.chain]);
  const read = parseChain(text);
  if (!read.value)
    throw new Error(
      `stacking would make ${at.chain} unreadable — ${read.issues[0]?.message ?? ""}`,
    );

  const atFile = chainFilePath(dir, at.chain);
  const bornFile = chainFilePath(dir, born.chain);
  wsWriteText(atFile, text);
  rmSync(bornFile, { force: true });
  const written = [
    relative(dir, atFile),
    `${relative(dir, bornFile)} (removed)`,
  ];
  // Its pin placed a loose card; in a chain it is laid out with the chain, so the pin goes.
  const pins = readLayout(dir);
  if (pins[node]) {
    delete pins[node];
    writeLayout(dir, pins);
    written.push(LAYOUT_FILE);
  }
  return written;
}
