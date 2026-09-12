// sequenceLoops.ts — after a sequence is DOUBLED, halve the loop count of every placement of it,
// so what was four passes of one bar is two passes of two and the arrangement does not move.
// Across every lane, every take and every alternative — the per-file writer is @studio/song-schema's
// halveSequenceLoops. See docs/sequenceLoops.md.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
  const at = join(dir, "nodes");
  if (!existsSync(at)) return out;
  let names: string[];
  try {
    names = readdirSync(at)
      .filter((f) => /\.ya?ml$/i.test(f))
      .sort();
  } catch {
    return out; // no lanes to reach is not a failure to halve
  }
  for (const f of names) {
    const rel = `nodes/${f}`;
    let before: string;
    try {
      before = readFileSync(join(at, f), "utf8");
    } catch {
      continue;
    }
    const { text, halved, kept } = halveSequenceLoops(before, ref);
    const lane = f.replace(/\.ya?ml$/i, "");
    out.kept.push(...kept.map((k) => ({ ...k, lane })));
    if (!halved) continue;
    snapshot?.(join(at, f));
    writeFileSync(join(at, f), text, "utf8");
    out.files.push(rel);
    out.halved += halved;
  }
  return out;
}
