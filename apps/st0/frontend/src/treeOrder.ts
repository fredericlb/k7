// treeOrder.ts — the order every tree on this screen is drawn in: alphabetical, folders and
// files mixed together, blind to case and accents, and "2" before "10". One comparator, so the
// families' tree and a repository's read the same way rather than each in the order its own
// listing happened to arrive in.

// Intl rather than `<`: "Ébène" belongs beside "Ebene", and a take numbered 10 after one numbered 2.
const collator = new Intl.Collator("fr", {
  numeric: true,
  sensitivity: "base",
});

/** Sort a level and everything under it. Returns new arrays and new nodes — what comes in is
 *  React state, and a sort in place would mutate it. */
export function sortNodes<N extends { name: string; children?: N[] }>(
  nodes: N[],
): N[] {
  return nodes
    .map((n) => (n.children ? { ...n, children: sortNodes(n.children) } : n))
    .sort((a, b) => collator.compare(a.name, b.name));
}
