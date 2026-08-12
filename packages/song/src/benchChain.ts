// benchChain.ts — a médiathèque chain, as a project the bench can play, and back again.
//
// A shared chain runs from `@in` to `@out`: it describes a treatment and says nothing about what
// goes through it. A bench is a real l8 project, so it has a TRACK to put material on, a strip to
// set the level, and a sink to hear. The two files are otherwise the same shape, which is what
// makes this a translation of the edges and not a conversion.
//
// The pair has to be exactly reversible or saving damages the chain, so both directions live here,
// beside each other, under one set of round-trip tests. See apps/st0/docs/banc.md.

import { formatChains, parseChains } from "./yaml/chainsFile";
import type { ChainsFile } from "./yaml/chainsSchema";

/** The boundary nodes a shared chain is written between. */
export const CHAIN_IN = "@in";
export const CHAIN_OUT = "@out";

/** The file this translates, named once — a chain folder and an l8 project both hold one. */
export const CHAIN_FILE = "chains.yaml";

/** What the bench scaffold calls its own furniture — see scaffoldBench. */
export interface BenchEdges {
  /** The track material is placed on; what `@in` becomes. */
  track: string;
  /** The sink; what `@out` becomes. */
  out: string;
  /** The strip, spliced before the sink so there is a level to set. Omitted, nothing is spliced. */
  strip?: string;
}

/**
 * The leading comment block, kept apart so a translation does not silently eat it.
 *
 * `formatChains` emits a canonical document from the parsed structure, which is what makes the
 * round trip provable — and would drop every comment in the file. Only the header is recoverable
 * that way, and it is the one that carries what the chain IS: the médiathèque's own chains open
 * with a paragraph naming the effect and pointing at the doc page it came from.
 */
function splitHeader(text: string): { header: string; body: string } {
  const lines = text.split(/\r?\n/);
  let i = 0;
  while (
    i < lines.length &&
    (lines[i].startsWith("#") || lines[i].trim() === "")
  )
    i++;
  // Trailing blank lines belong to the gap, not the header.
  const head = lines.slice(0, i);
  while (head.length && head[head.length - 1].trim() === "") head.pop();
  return { header: head.join("\n"), body: lines.slice(i).join("\n") };
}

const rename = (dests: string[], from: string, to: string): string[] =>
  dests.map((d) => (d === from ? to : d));

function mapFile(
  file: ChainsFile,
  fn: (node: string, dests: string[]) => [string, string[]] | null,
): ChainsFile {
  const out: ChainsFile = {};
  const next: Record<string, string[]> = {};
  for (const [node, dests] of Object.entries(file.modules ?? {})) {
    const kept = fn(node, dests);
    if (kept) next[kept[0]] = kept[1];
  }
  if (Object.keys(next).length) out.modules = next;
  if (file.bypassed?.length) out.bypassed = [...file.bypassed];
  return out;
}

/**
 * Whether the bench's furniture would collide with the chain's own nodes.
 *
 * A chain naming a module `mixer` cannot be opened on a bench whose strip is also `mixer`: the
 * save would take the strip out and remove the chain's module with it. Refused rather than
 * guessed at — renaming somebody's module to make room would change the chain being edited.
 */
export function benchChainCollision(
  text: string,
  edges: BenchEdges,
): string | null {
  const { value } = parseChains(splitHeader(text).body);
  if (!value) return null; // a file that will not parse is the loader's error to report
  const names = new Set([
    ...Object.keys(value.modules ?? {}),
    ...Object.values(value.modules ?? {}).flat(),
  ]);
  names.delete(CHAIN_IN);
  names.delete(CHAIN_OUT);
  for (const furniture of [edges.track, edges.out, edges.strip]) {
    if (furniture && names.has(furniture))
      return `this chain already has a node called "${furniture}", which is what the bench calls its own — rename it, or it would be taken for the bench's when the chain is saved`;
  }
  return null;
}

/** A shared chain as the bench's `chains.yaml`: `@in` becomes the track, `@out` the sink. */
export function chainToBench(text: string, edges: BenchEdges): string {
  const { header, body } = splitHeader(text);
  const { value } = parseChains(body);
  if (!value) return text; // unparseable: hand it over untouched rather than emit a wrong file
  const sink = edges.strip ?? edges.out;

  const moved = mapFile(value, (node, dests) => [
    node === CHAIN_IN ? edges.track : node,
    rename(dests, CHAIN_OUT, sink),
  ]);
  // The strip is spliced only when something reaches it, so a chain that was `@in → @out` does not
  // grow furniture it never routed through.
  if (edges.strip) {
    const strip = edges.strip;
    const reaches = Object.values(moved.modules ?? {}).some((d) =>
      d.includes(strip),
    );
    if (reaches) moved.modules = { ...moved.modules, [strip]: [edges.out] };
  }
  return formatChains(moved, header);
}

/** …and back: the track becomes `@in`, the strip is taken out, everything reaching the sink says `@out`. */
export function chainFromBench(text: string, edges: BenchEdges): string {
  const { header, body } = splitHeader(text);
  const { value } = parseChains(body);
  if (!value) return text;

  const back = mapFile(value, (node, dests) => {
    // The strip is the bench's, not the chain's: dropped as a node, and anything that pointed at
    // it now points where it pointed — the sink, which is `@out` on the other side.
    if (edges.strip && node === edges.strip) return null;
    const to = node === edges.track ? CHAIN_IN : node;
    let next = rename(dests, edges.out, CHAIN_OUT);
    if (edges.strip) next = rename(next, edges.strip, CHAIN_OUT);
    return [to, next];
  });
  return formatChains(back, header);
}
