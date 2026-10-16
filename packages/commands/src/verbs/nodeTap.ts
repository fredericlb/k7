// nodeTap.ts — the taps of a rack node: notes, samples, chains, mute and output.
// See docs/verbs.md.

import { libraryFiles } from "@studio/song/libraryFiles";
import {
  addTap,
  kitOf,
  removeTap,
  renameTap,
  setTap,
  setTapOut,
} from "@studio/song-edit/rackTaps";
import {
  addTapChainNode,
  moveTapChainNode,
  removeTapChainNode,
} from "@studio/song-edit/tapChain";
import type { CommandHost, SidHandler } from "../commands.ts";
import { splitArgs } from "./shared.ts";

/** Run one tap write, say what it did, and reload — a rack's sounds are built when its plugin is. */
async function tapEdit(
  h: CommandHost,
  write: () => unknown,
  said: string,
): Promise<void> {
  try {
    write();
    h.log([said]);
    await h.reload();
  } catch (e) {
    h.refuse([`node tap: ${(e as Error).message}`]);
  }
}

export const NODE_TAP_VERBS: Record<string, SidHandler> = {
  /** A rack node's taps — note, sample, add, insert, rename, remove — each one write to the NODE's file and a reload; docs/verbs.md. */
  "node.tap.note": async (a, h) => {
    const [node, symbol, raw] = splitArgs(a);
    const note = Number(raw);
    if (!node || !symbol || !Number.isInteger(note) || note < 0 || note > 127)
      return h.refuse(["usage: node tap note <node> <symbol> <0-127>"]);
    await tapEdit(
      h,
      () => setTap(h.songPath, node, symbol, { note }),
      `${node}: ${symbol} on note ${note}`,
    );
  },
  "node.tap.sample": async (a, h) => {
    const [node, symbol, file] = splitArgs(a);
    if (!node || !symbol || !file)
      return h.refuse([
        "usage: node tap sample <node> <symbol> <@library/path | none>",
      ]);
    const clearing = file === "none";
    // The libraries' samples and this project's own, by the name the tap's picker offered.
    if (!clearing && !libraryFiles("samples", h.songPath).includes(file))
      return h.refuse([
        `no '${file}' in the libraries' or the project's samples/ — drop it into one first`,
      ]);
    await tapEdit(
      h,
      () =>
        setTap(h.songPath, node, symbol, { sample: clearing ? null : file }),
      `${node}: ${symbol} ${clearing ? "has no sample" : `plays ${file}`}`,
    );
  },
  "node.tap.add": async (a, h) => {
    const [node, symbol] = splitArgs(a);
    if (!node) return h.refuse(["usage: node tap add <node> [symbol]"]);
    try {
      const made = addTap(h.songPath, node, symbol);
      h.log([
        `${node}: tap ${made.symbol} on note ${made.note} — pick its sample`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node tap add: ${(e as Error).message}`]);
    }
  },
  // An empty cell of the octave grid: a tap on THAT note (packages/song/docs/racks.md).
  "node.tap.at": async (a, h) => {
    const [node, at, symbol] = splitArgs(a);
    const note = Number(at);
    if (!node || at === undefined || !Number.isInteger(note))
      return h.refuse(["usage: node tap at <node> <note> [symbol]"]);
    try {
      const made = addTap(h.songPath, node, symbol, note);
      h.log([
        `${node}: tap ${made.symbol} on note ${made.note} — pick its sample`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node tap at: ${(e as Error).message}`]);
    }
  },
  "node.tap.insert": async (a, h) => {
    const [node, side, beside, symbol] = splitArgs(a);
    if (!node || (side !== "before" && side !== "after") || !beside)
      return h.refuse([
        "usage: node tap insert <node> <before|after> <tap> [symbol]",
      ]);
    try {
      const made = addTap(h.songPath, node, symbol, { symbol: beside, side });
      h.log([
        `${node}: tap ${made.symbol} on note ${made.note}, ${side} ${beside} — pick its sample`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node tap insert: ${(e as Error).message}`]);
    }
  },
  "node.tap.rename": async (a, h) => {
    const [node, symbol, name] = splitArgs(a);
    if (!node || !symbol || !name)
      return h.refuse(["usage: node tap rename <node> <symbol> <new name>"]);
    await tapEdit(
      h,
      () => renameTap(h.songPath, node, symbol, name),
      `${node}: tap ${symbol} is now ${name}`,
    );
  },
  /** node tap mute <node> <symbol> [on|off] — a TOGGLE without the word; the tap stays, silent. */
  "node.tap.mute": async (a, h) => {
    const [node, symbol, word] = splitArgs(a);
    if (!node || !symbol || (word && word !== "on" && word !== "off"))
      return h.refuse(["usage: node tap mute <node> <symbol> [on|off]"]);
    let on = word === "on";
    if (!word)
      try {
        on = !kitOf(h.songPath, node).symbols[symbol]?.mute;
      } catch (e) {
        return h.refuse([`node tap mute: ${(e as Error).message}`]);
      }
    await tapEdit(
      h,
      () => setTap(h.songPath, node, symbol, { mute: on }),
      `${node}: ${symbol} ${on ? "muted" : "unmuted"}`,
    );
  },
  /** node tap out <node> <tap> <subchain|none> — the tap leaves by an output of its own, into that subchain (song docs/racks.md). */
  "node.tap.out": async (a, h) => {
    const [node, symbol, sub] = splitArgs(a);
    if (!node || !symbol || !sub)
      return h.refuse(["usage: node tap out <node> <tap> <subchain|none>"]);
    const to = sub === "none" ? null : sub;
    await tapEdit(
      h,
      () => setTapOut(h.songPath, node, symbol, to),
      `${node}: ${symbol} ${to ? `leaves for ${to}` : "back on the main output"}`,
    );
  },
  /** node tap chain add <node> <tap> <module> — the tap's own chain grows by one, made the first time (song docs/racks.md). */
  "node.tap.chain.add": async (a, h) => {
    const [node, symbol, ref] = splitArgs(a);
    if (!node || !symbol || !ref)
      return h.refuse(["usage: node tap chain add <node> <tap> <module>"]);
    await tapEdit(
      h,
      () => addTapChainNode(h.songPath, node, symbol, ref).subchain,
      `${node}: ${symbol} goes through ${ref}`,
    );
  },
  "node.tap.chain.remove": async (a, h) => {
    const [node, symbol, id] = splitArgs(a);
    if (!node || !symbol || !id)
      return h.refuse(["usage: node tap chain remove <node> <tap> <node-id>"]);
    let emptied = false;
    await tapEdit(
      h,
      () => {
        emptied = removeTapChainNode(h.songPath, node, symbol, id).emptied;
        return "";
      },
      `${node}: removed from ${symbol}'s chain`,
    );
    if (emptied)
      h.log([
        `${node}: ${symbol}'s chain is empty — the tap is back on the main output`,
      ]);
  },
  "node.tap.chain.move": async (a, h) => {
    const [node, symbol, id, way] = splitArgs(a);
    if (!node || !symbol || !id || (way !== "up" && way !== "down"))
      return h.refuse([
        "usage: node tap chain move <node> <tap> <node-id> <up|down>",
      ]);
    await tapEdit(
      h,
      () => {
        moveTapChainNode(h.songPath, node, symbol, id, way === "up" ? -1 : 1);
        return "";
      },
      `${node}: ${symbol}'s chain reordered`,
    );
  },
  "node.tap.remove": async (a, h) => {
    const [node, symbol] = splitArgs(a);
    if (!node || !symbol)
      return h.refuse(["usage: node tap remove <node> <symbol>"]);
    await tapEdit(
      h,
      () => removeTap(h.songPath, node, symbol),
      `${node}: tap ${symbol} removed`,
    );
  },
};
