// sequenceLoops.ts — after a sequence is DOUBLED, halve the loop count of every placement of it,
// so what was four passes of one bar is two passes of two and the arrangement does not move.
// Across every lane, every take and every alternative — the per-file writer is @studio/song-schema's
// halveSequenceLoops. See docs/sequenceLoops.md.

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { K7Document } from "@studio/k7x/document";
import {
  chainFiles,
  editChainItemIn,
  eventItemIds,
  laneFolder,
} from "@studio/song/chainItemEdit";
import { wsText, wsWriteText } from "@studio/song/yaml/workspaceDoc";
import { isDocName, wsExists } from "@studio/song/yaml/workspaceFile";
import { stripDocExt } from "@studio/song-schema/docExt";
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
    if (wsExists(at))
      names = readdirSync(at)
        .filter((f) => isDocName(f))
        .sort();
  } catch {
    names = []; // no lanes to reach is not a failure to halve
  }
  const rels = [...names.map((f) => `${folder}/${f}`), ...chainFiles(dir)];
  for (const rel of rels) {
    const path = join(dir, rel);
    let doc: K7Document;
    try {
      doc = new K7Document(wsText(path));
    } catch {
      continue;
    }
    const isChain = !rel.startsWith(`${folder}/`);
    const { halved, kept } = isChain
      ? halveInChain(doc, ref)
      : halveSequenceLoops(doc.at([]), ref);
    const lane = stripDocExt(rel.slice(rel.indexOf("/") + 1));
    out.kept.push(...kept.map((k) => ({ ...k, lane })));
    if (!halved) continue;
    snapshot?.(path);
    wsWriteText(path, doc.toString());
    out.files.push(rel);
    out.halved += halved;
  }
  return out;
}

// The same over a chain file: every node item holding events of its own (docs/chainFiles.md).
function halveInChain(
  doc: K7Document,
  ref: string,
): { halved: number; kept: KeptLoop[] } {
  let halved = 0;
  const kept: KeptLoop[] = [];
  for (const id of eventItemIds(doc.toString()))
    editChainItemIn(doc, id, (item) => {
      const r = halveSequenceLoops(item, ref);
      halved += r.halved;
      kept.push(...r.kept);
    });
  return { halved, kept };
}
