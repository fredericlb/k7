// tapOuts.ts — a rack node's taps routed to subchains: which output PAIR each takes, and the note it plays.
// Pair 0 is the instrument's main output; routed taps take 1, 2, … in the order of their names, so a rebuild
// lands every tap on the pair it had. See docs/racks.md ("A tap with a chain of its own").

import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";

export interface TapFeed {
  node: string;
  tap: string;
  /** The first node of the subchain the tap feeds. */
  to: string;
}

export interface RoutedTap extends TapFeed {
  pair: number;
}

/** The feeds a graph file carries; none when it states none. */
export function tapFeedsOf(raw: unknown): TapFeed[] {
  const feeds = (raw as GraphFile | undefined)?.tap_feeds;
  return Array.isArray(feeds) ? feeds : [];
}

/** Each node's routed taps, sorted by name, numbered from pair 1. */
export function tapPairs(feeds: TapFeed[]): Map<string, RoutedTap[]> {
  const byNode = new Map<string, RoutedTap[]>();
  for (const f of feeds)
    byNode.set(f.node, [...(byNode.get(f.node) ?? []), { ...f, pair: 0 }]);
  for (const list of byNode.values()) {
    list.sort((a, b) => a.tap.localeCompare(b.tap));
    list.forEach((t, i) => {
      t.pair = i + 1;
    });
  }
  return byNode;
}

/** The `{ note, pair }` list a plugin carries, or a refusal naming the tap the instrument does not have. */
export function tapOutsFor(
  node: string,
  routed: RoutedTap[],
  noteOf: (tap: string) => number | undefined,
): { note: number; pair: number }[] {
  return routed.map((t) => {
    const note = noteOf(t.tap);
    if (note === undefined || !Number.isFinite(note))
      throw new Error(
        `node '${node}': tap '${t.tap}' is routed to a subchain, but the node has no tap of that name`,
      );
    return { note, pair: t.pair };
  });
}
