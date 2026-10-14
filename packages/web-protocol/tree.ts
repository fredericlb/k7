// tree.ts — the order a FileNode tree is drawn in: alphabetical, folders and files mixed
// together, blind to case and accents, and "2" before "10". Here rather than in an app because
// two of them draw the same tree — pl8 its families, k7 a repository's — and an order that
// differed between them would make one listing unreadable in the other's terms.

// Intl rather than `<`: "Ébène" belongs beside "Ebene", and a take numbered 10 after one numbered 2.
const collator = new Intl.Collator("fr", {
  numeric: true,
  sensitivity: "base",
});

/** Sort a level and everything under it, into NEW arrays: what comes in is React state. */
export function sortNodes<N extends { name: string; children?: N[] }>(
  nodes: N[],
): N[] {
  return nodes
    .map((n) => (n.children ? { ...n, children: sortNodes(n.children) } : n))
    .sort((a, b) => collator.compare(a.name, b.name));
}
