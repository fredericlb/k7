// clipOps.ts — running a library CHAIN over one clip: the vocabulary two surfaces share. The
// waveform panel offers it as its "operations" menu, the text editor as a Process button, and
// both mean one command. Kept here so a second surface cannot spell any part of it differently.

/**
 * The token a library chain is named by.
 *
 * `@studio/commands`' own `MEDIATEK_CHAIN`, which that package does not publish as an export
 * subpath — so this is a copy, and it is here rather than in each surface so there is exactly
 * one. `clip process` refuses a ref without it.
 */
export const MEDIATEK_CHAIN = "@st0/";

/** Every library chain, as `clip process` names it. */
export function chainOps(
  chains: { ref: string }[] | null | undefined,
): string[] {
  return (chains ?? []).map((c) => `${MEDIATEK_CHAIN}${c.ref}`);
}

/**
 * Filtered on the WHOLE ref, not just the last segment.
 *
 * A chain is filed by path and nobody remembers which folder it went in, so typing a word finds
 * it wherever it sits. An empty search is every chain rather than none.
 */
export function filterOps(ops: string[], search: string): string[] {
  const q = search.trim().toLowerCase();
  return q ? ops.filter((o) => o.toLowerCase().includes(q)) : ops;
}

/**
 * The command line.
 *
 * `clip` is the clip's REF — its id — and not the path of the file that declares it: the editor
 * has `clips/<ref>.yaml` open and has to hand over the stem, because that is the only name the
 * verb knows. The render lands beside the source, stamped, and the clip is repointed at it;
 * that half is the command's (see @studio/commands docs/processChain.md).
 */
export function processLine(clip: string, chain: string): string {
  return `clip process ${clip} ${chain}`;
}
