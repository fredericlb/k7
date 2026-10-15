// clipOps.ts — running a library CHAIN over one clip: the vocabulary two surfaces share. The
// waveform panel offers it as its "operations" menu, the text editor as a Process button, and
// both mean one command. Kept here so a second surface cannot spell any part of it differently.

/** Every library chain, as `clip process` names it — its `@<library>/<path>` ref, which the file service answers whole. */
export function chainOps(
  chains: { ref: string }[] | null | undefined,
): string[] {
  return (chains ?? []).map((c) => c.ref);
}

/** Filtered on the WHOLE ref: a chain is filed by path, and an empty search is every chain rather than none. */
export function filterOps(ops: string[], search: string): string[] {
  const q = search.trim().toLowerCase();
  return q ? ops.filter((o) => o.toLowerCase().includes(q)) : ops;
}

/** The command line: `clip` is the clip's REF and not its file's path, that stem being the only name the verb knows. */
export function processLine(clip: string, chain: string): string {
  return `clip process ${clip} ${chain}`;
}
