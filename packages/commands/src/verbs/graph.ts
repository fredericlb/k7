// graph.ts — the graph's wiring and layout (pin, unlink, organize, move, chain connect /
// disconnect / replug) and the assemblies drawn on it. See docs/verbs.md.

import {
  assemblyMembers,
  createAssembly,
  dissolveAssembly,
} from "@studio/song/assemblyEdit";
import { chainNodeName } from "@studio/song/chainGraphEdit";
import { loadCurves } from "@studio/song/curves";
import { loadGraph } from "@studio/song/graph";
import {
  clearChainNodePositions,
  connectChainNodes,
  deleteChainNode,
  disconnectChainNodes,
  replugChainNodes,
  setChainNodePosition,
  setChainNodePositions,
  unlinkChainNode,
} from "@studio/song-edit/projectEdit";
import { isBuiltinOutput } from "@studio/song-schema/moduleTypes";
import type { SidHandler } from "../commands.ts";
import { runCarriesInput, splitWords, takeSpawnAt } from "./shared.ts";

/** The pair the graph DRAWS whether or not graph.yaml states it: a sum straight to its device — packages/song/docs/masterChain.md. */
/** Does this name a node of THIS graph? The five built-in outputs count — they simply have no folder. */
function namesANode(g: ReturnType<typeof loadGraph>, name: string): boolean {
  return (
    isBuiltinOutput(name) ||
    name in g.modules ||
    name in g.moduleRefs ||
    name in g.tracks ||
    // A PICTURE lane is a card too, and `videoTracks` is its own key (packages/song/docs/camera.md).
    name in g.videoTracks
  );
}

/** The names there ARE, for a refusal that can be acted on — one sentence, so the verbs cannot list different sets. */
function knownNodes(g: ReturnType<typeof loadGraph>): string {
  const parts = [`modules: ${Object.keys(g.modules).join(", ") || "none"}`];
  const lanes = Object.keys(g.videoTracks);
  if (lanes.length) parts.push(`picture lanes: ${lanes.join(", ")}`);
  const boxes = Object.keys(g.assemblies);
  if (boxes.length) parts.push(`assemblies: ${boxes.join(", ")}`);
  return parts.join("; ");
}

export const GRAPH_VERBS: Record<string, SidHandler> = {
  /** `graph pin <JSON {node: {x,y}}>` — record where the graph drew itself, one batched write; docs/verbs.md. */
  "graph.pin": async (a, h) => {
    const payload = a.trim();
    if (!payload) {
      h.refuse([
        'usage: graph pin <JSON {node: {x,y}}>  (e.g. graph pin {"reverb":{"x":420,"y":180}})',
      ]);
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(payload);
    } catch (e) {
      h.refuse([`bad positions JSON: ${(e as Error).message}`]);
      return;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      h.refuse(["positions payload must be a JSON object of node -> {x,y}"]);
      return;
    }
    const at: Record<string, { x: number; y: number }> = {};
    for (const [node, v] of Object.entries(raw as Record<string, unknown>)) {
      const p = v as { x?: unknown; y?: unknown };
      const x = Number(p?.x);
      const y = Number(p?.y);
      if (!node || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      at[node] = { x, y };
    }
    if (!Object.keys(at).length) {
      h.refuse(["no usable {x,y} in the payload"]);
      return;
    }
    try {
      const path = setChainNodePositions(h.songPath, at);
      h.log([`pinned ${Object.keys(at).length} node(s) (${path})`]);
    } catch (e) {
      h.refuse([`graph pin: ${(e as Error).message}`]);
    }
  },
  /** assembly new <ref> <name> [x,y] — a templated box of nodes, wiring and all; docs/assemblies.md. */
  "assembly.new": async (a, h) => {
    const usage = "usage: assembly new <template-ref> <name> [x,y]";
    const parts = splitWords(a);
    const at = takeSpawnAt(parts);
    if (parts.length !== 2) {
      h.refuse([usage]);
      return;
    }
    const [ref, name] = parts;
    try {
      const { file, members } = createAssembly(
        h.songPath,
        ref,
        name,
        at ?? undefined,
      );
      h.log([
        `created ${file} — ${Object.keys(members).length} nodes, drawn as one box`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`assembly new failed: ${(e as Error).message}`]);
    }
  },
  /** assembly delete <name> — the record AND every node it holds, each spliced out like `node delete`. */
  "assembly.delete": async (a, h) => {
    const name = splitWords(a)[0];
    if (!name) {
      h.refuse(["usage: assembly delete <name>"]);
      return;
    }
    try {
      const members = assemblyMembers(h.songPath, name);
      // The record goes FIRST: each delete below asks the assemblies which boxes hold the node.
      const file = dissolveAssembly(h.songPath, name);
      const removed: string[] = [];
      for (const node of members) {
        // A member with no file left is one somebody already deleted — not a reason to stop halfway.
        try {
          removed.push(...deleteChainNode(h.songPath, node).removed);
        } catch {}
      }
      h.log([`deleted ${file} and ${removed.length} of its files`]);
      await h.reload();
    } catch (e) {
      h.refuse([`assembly delete failed: ${(e as Error).message}`]);
    }
  },
  /** assembly dissolve <name> — the record only; every node stays on the graph, wired as it was. */
  "assembly.dissolve": async (a, h) => {
    const name = splitWords(a)[0];
    if (!name) {
      h.refuse(["usage: assembly dissolve <name>"]);
      return;
    }
    try {
      const members = assemblyMembers(h.songPath, name);
      const file = dissolveAssembly(h.songPath, name);
      h.log([
        `dropped ${file} — its ${members.length} nodes are on the graph, untouched`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`assembly dissolve failed: ${(e as Error).message}`]);
    }
  },
  // graph unlink <node> — out of the signal path, files untouched, so it goes back with `node insert`.
  "graph.unlink": async (a, h) => {
    const node = splitWords(a)[0];
    if (!node) {
      h.refuse(["usage: graph unlink <node>"]);
      return;
    }
    try {
      const { rewired } = unlinkChainNode(h.songPath, node);
      h.log([
        `unlinked ${node}` +
          (rewired.length
            ? ` and rejoined what fed it: ${rewired.join(", ")}`
            : " — nothing fed it, so there was nothing to rejoin") +
          "; it stays in the graph, wired to nothing",
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph unlink failed: ${(e as Error).message}`]);
    }
  },
  // Creating a node is `node new`'s and wiring one is `node insert`'s — docs/verbs.md.

  /** graph organize — hand EVERY node back to the layout, the ONLY reorganizing operation; docs/verbs.md. */
  "graph.organize": async (_a, h) => {
    try {
      clearChainNodePositions(h.songPath);
      h.log(["graph reorganized — every node handed back to the layout"]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph organize failed: ${(e as Error).message}`]);
    }
  },
  /** graph move <node> <x> <y> — pin a node into graph.yaml's `positions:`; `auto` hands it back, docs/verbs.md. */
  "graph.move": async (a, h) => {
    const usage =
      "usage: graph move <node> <x> <y> (world px), or `graph move <node> auto`";
    const parts = splitWords(a);
    if (parts.length < 2) {
      h.refuse([usage]);
      return;
    }
    const [name, xArg, yArg] = parts;
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.refuse([`graph move: ${(e as Error).message}`]);
      return;
    }
    // Everything on the graph is a NODE and every node can be put somewhere; the curves read is best-effort.
    const curves = (() => {
      try {
        return loadCurves(h.songPath);
      } catch {
        return {};
      }
    })();
    // An ASSEMBLY is drawn as a card and pinned like one, though it is no key of `modules:` —
    // one flat key space, so its name sits in `positions:` beside every node's (docs/assemblies.md).
    if (
      !isBuiltinOutput(name) &&
      !(name in g.modules) &&
      !(name in g.tracks) &&
      // A picture lane is a CARD on the graph like any other, and `videoTracks` is its own key.
      !(name in g.videoTracks) &&
      !(name in g.assemblies) &&
      !(name in curves)
    ) {
      h.refuse([`no node "${name}" in this project (${knownNodes(g)})`]);
      return;
    }
    try {
      if (xArg.toLowerCase() === "auto") {
        setChainNodePosition(h.songPath, name, null);
        h.log([`${name}: back to the layout`]);
      } else {
        const x = Number(xArg);
        const y = Number(yArg);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          h.refuse([usage]);
          return;
        }
        // Negative is allowed, and is the point: a node belongs above the first track as readily as below it.
        setChainNodePosition(h.songPath, name, { x, y });
        h.log([`${name}: pinned at ${Math.round(x)},${Math.round(y)}`]);
      }
      await h.reload();
    } catch (e) {
      h.refuse([`graph move failed: ${(e as Error).message}`]);
    }
  },
  /** graph chain connect <from> <to> — the patch-cable gesture; either end may carry `#port` (packages/song/docs/ports.md). */
  "graph.chain.connect": async (a, h) => {
    const usage =
      "usage: graph chain connect <from> <to> — each a node, optionally name#port (e.g. graph chain connect gtr reverb)";
    const parts = splitWords(a);
    if (parts.length !== 2) {
      h.refuse([usage]);
      return;
    }
    const [from, to] = parts.map((p) => chainNodeName(h.songPath, p));
    const base = (s: string) => s.split("#")[0];
    if (base(from) === base(to)) {
      h.refuse([`can't connect '${base(from)}' to itself`]);
      return;
    }
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.refuse([`graph chain connect: ${(e as Error).message}`]);
      return;
    }
    if (base(from) === "OUT") {
      h.refuse(["OUT is the sink — it has no output to connect from"]);
      return;
    }
    // A lane MAY be fed, by exactly one thing: a run carrying a live interface input — docs/verbs.md.
    if (base(to) in g.tracks && !runCarriesInput(g, base(from))) {
      h.refuse([
        `'${base(to)}' is a track — only a live input's signal lands on a lane`,
      ]);
      return;
    }
    const known = (name: string) => namesANode(g, name);
    for (const end of [from, to])
      if (!known(base(end))) {
        h.refuse([`no node "${base(end)}" in this project (${knownNodes(g)})`]);
        return;
      }
    try {
      connectChainNodes(h.songPath, from, to);
      h.log([`connected ${from} → ${to}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph chain connect failed: ${(e as Error).message}`]);
    }
  },
  /** graph chain disconnect <from> <to> — pull ONE cable out; no graph load, the file's own refusal IS the check. */
  "graph.chain.disconnect": async (a, h) => {
    const parts = splitWords(a);
    if (parts.length !== 2) {
      h.refuse([
        "usage: graph chain disconnect <from> <to> — each a node, optionally name#port",
      ]);
      return;
    }
    const [from, to] = parts.map((p) => chainNodeName(h.songPath, p));
    try {
      disconnectChainNodes(h.songPath, from, to);
      h.log([`disconnected ${from} → ${to}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph chain disconnect failed: ${(e as Error).message}`]);
    }
  },
  /** graph chain replug <from> <to> <newFrom> <newTo> — move one end of an arrow in ONE write, one undo step. */
  "graph.chain.replug": async (a, h) => {
    const usage =
      "usage: graph chain replug <from> <to> <newFrom> <newTo> — the arrow from→to becomes newFrom→newTo";
    const parts = splitWords(a);
    if (parts.length !== 4) {
      h.refuse([usage]);
      return;
    }
    const [from, to, newFrom, newTo] = parts;
    if (from === newFrom && to === newTo) {
      h.refuse(["nothing moved — the cable is where it was"]);
      return;
    }
    const base = (s: string) => s.split("#")[0];
    if (base(newFrom) === base(newTo)) {
      h.refuse([`can't connect '${base(newFrom)}' to itself`]);
      return;
    }
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.refuse([`graph chain replug: ${(e as Error).message}`]);
      return;
    }
    if (base(newFrom) === "OUT") {
      h.refuse(["OUT is the sink — it has no output to connect from"]);
      return;
    }
    if (base(newTo) in g.tracks) {
      h.refuse([`'${base(newTo)}' is a track — a source; nothing can feed it`]);
      return;
    }
    const known = (name: string) => namesANode(g, name);
    for (const end of [newFrom, newTo])
      if (!known(base(end))) {
        h.refuse([`no node "${base(end)}" in this project (${knownNodes(g)})`]);
        return;
      }
    try {
      replugChainNodes(h.songPath, from, to, newFrom, newTo);
      h.log([`replugged: ${from} → ${to} is now ${newFrom} → ${newTo}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`graph chain replug failed: ${(e as Error).message}`]);
    }
  },
};
