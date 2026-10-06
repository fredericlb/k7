// sequenceLoops.ts — after a sequence is DOUBLED, halve the loop count of every placement of it,
// so what was four passes of one bar is two passes of two and the arrangement does not move.
// Across every lane, every take and every alternative — the per-file writer is @studio/song-schema's
// halveSequenceLoops. See docs/sequenceLoops.md.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chainFiles,
  eventItemIds,
  laneFolder,
  spliceChainItem,
} from "@studio/song/chainItemEdit";
import {
  halveSequenceLoops,
  type KeptLoop,
} from "@studio/song-schema/yaml/trackFile";

/** What the halving reached, and what it deliberately did not — what the command reports. */
export interface LoopHalving {
  /** Lane files rewritten, project-relative, in the order they were written. */
  files: string[];
  halved: number;
  /** One entry per placement left as it was, named by its lane and its start. */
  kept: (KeptLoop & { lane: string })[];
}

/** Halve the loop of every placement of `ref` across the project's lanes. */
export function halveLoopsOf(
  dir: string,
  ref: string,
  /** Called with a lane's path BEFORE it is overwritten, so a host's undo has the old bytes. */
  snapshot?: (path: string) => void,
): LoopHalving {
  const out: LoopHalving = { files: [], halved: 0, kept: [] };
  const folder = laneFolder(dir);
  const at = join(dir, folder);
  let names: string[] = [];
  try {
    if (existsSync(at))
      names = readdirSync(at)
        .filter((f) => /\.ya?ml$/i.test(f))
        .sort();
  } catch {
    names = []; // no lanes to reach is not a failure to halve
  }
  const rels = [...names.map((f) => `${folder}/${f}`), ...chainFiles(dir)];
  for (const rel of rels) {
    const path = join(dir, rel);
    let before: string;
    try {
      before = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const isChain = !rel.startsWith(`${folder}/`);
    const { text, halved, kept } = isChain
      ? halveInChain(before, ref)
      : halveSequenceLoops(before, ref);
    const lane = rel.slice(rel.indexOf("/") + 1).replace(/\.ya?ml$/i, "");
    out.kept.push(...kept.map((k) => ({ ...k, lane })));
    if (!halved) continue;
    snapshot?.(path);
    writeFileSync(path, text, "utf8");
    out.files.push(rel);
    out.halved += halved;
  }
  return out;
}

// The same over a chain file: every node item holding events of its own (docs/chainFiles.md).
function halveInChain(
  text: string,
  ref: string,
): { text: string; halved: number; kept: KeptLoop[] } {
  let out = text;
  let halved = 0;
  const kept: KeptLoop[] = [];
  for (const id of eventItemIds(text))
    out = spliceChainItem(out, id, (t) => {
      const r = halveSequenceLoops(t, ref);
      halved += r.halved;
      kept.push(...r.kept);
      return r.text;
    });
  return { text: out, halved, kept };
}
