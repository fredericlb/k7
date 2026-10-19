// trackInput.ts — `track input <track> audio|midi`: an input node feeding a lane, what the per-track
// view's two buttons run. In a chain project it is a step of the lane's own chain, just ahead of the
// lane; in a graph.k7x project, a node with a cable onto it. A lane something already feeds is refused,
// the input's signal being the one thing a lane takes. See packages/commands/docs/verbs.md.

import { stringify } from "@studio/k7x/print";
import { insertChainInput } from "@studio/song/chainCreate";
import { isChainProject } from "@studio/song/chainProject";
import { loadGraph } from "@studio/song/graph";
import { createNode, freeNodeName } from "@studio/song/loader";
import {
  connectChainNodes,
  placeChainNode,
} from "@studio/song-edit/projectEdit";
import { MIDI_IN_NODE, metaRef } from "@studio/song-schema/moduleTypes";
import type { CommandHost, SidHandler } from "../commands.ts";
import { runCarriesInput, splitWords } from "./shared.ts";

export const TRACK_INPUT_VERBS: Record<string, SidHandler> = {
  "track.input": trackInput,
};

const USAGE = "usage: track input <track> audio|midi";

async function trackInput(a: string, h: CommandHost): Promise<void> {
  const [lane, kind] = splitWords(a);
  if (!lane || (kind !== "audio" && kind !== "midi")) {
    h.refuse([USAGE]);
    return;
  }
  const dir = h.songPath;
  try {
    const g = loadGraph(dir);
    if (!(lane in g.tracks)) {
      h.refuse([`no track "${lane}" in this project`]);
      return;
    }
    if (runCarriesInput(g, lane)) {
      h.refuse([`${lane} already has an input`]);
      return;
    }
    const role = kind === "midi" ? MIDI_IN_NODE : "IN";
    if (isChainProject(dir)) {
      // A USE of the built-in input, as a hand-written rig spells it: its card is then named by it.
      const body = stringify(
        kind === "midi"
          ? { extends: metaRef(MIDI_IN_NODE) }
          : { extends: metaRef("IN"), monitor: "auto" },
      );
      const { rel } = insertChainInput(dir, lane, body);
      h.log([`${lane}: ${kind} input added ahead of it (${rel})`]);
    } else {
      const node = freeNodeName(
        dir,
        kind === "midi" ? "midi_in" : "audio_in",
        lane,
      );
      createNode(dir, "io", role, node);
      placeChainNode(dir, node);
      connectChainNodes(dir, node, lane);
      h.log([`${lane}: ${kind} input ${node} wired to it`]);
    }
    await h.reload();
  } catch (e) {
    h.refuse([`track input: ${(e as Error).message}`]);
  }
}
