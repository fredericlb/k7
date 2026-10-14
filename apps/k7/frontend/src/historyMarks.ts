// historyMarks.ts — what a History panel row LIGHTS on the graph and the timeline: the lanes,
// clips, chains and nodes its changed files name. Read off the paths, project-relative, since a
// commit carries nothing else; a journal step's label may also name the very node it moved.
// Pure, so which file lights what is pinned by a test rather than by looking.

import type { WebGraph } from "@studio/graph-model";

/** What one row touched, by the names the two surfaces draw with. */
export interface HistoryMark {
  lanes: ReadonlySet<string>;
  clips: ReadonlySet<string>;
  chains: ReadonlySet<string>;
  /** Single nodes, when the label names one of a touched chain's — then that chain is NOT lit whole. */
  modules: ReadonlySet<string>;
}

const stem = (file: string) => file.replace(/\.[^./]+$/, "");

/** The marks for one step or commit: `paths` project-relative, `label` a journal step's command line. */
export function historyMarks(
  paths: readonly string[],
  label = "",
  graph?: WebGraph | null,
): HistoryMark {
  const lanes = new Set<string>();
  const clips = new Set<string>();
  const chains = new Set<string>();
  const modules = new Set<string>();
  // A command line names its node bare or quoted: `node param "e490…" "ir" …`.
  const words = new Set(label.split(/\s+/).map((w) => w.replace(/^"|"$/g, "")));
  for (const p of paths) {
    const [dir, ...rest] = p.split("/");
    const file = rest.join("/");
    if (!file) continue;
    if (dir === "tracks") lanes.add(stem(file));
    else if (dir === "sequences" || dir === "clips") clips.add(stem(file));
    else if (dir === "chains") {
      const chain = stem(file);
      const named = (graph?.chains?.[chain]?.use ?? [])
        .map((st) => st.module)
        .filter((m): m is string => !!m && words.has(m));
      if (named.length) for (const m of named) modules.add(m);
      else chains.add(chain);
    }
  }
  return { lanes, clips, chains, modules };
}

/** Whether a graph card is one `mark` lights: its lane, its own name, or the chain it is in. */
export function nodeMarked(
  mark: HistoryMark,
  n: { kind: string; module?: string; chain?: string; chains?: string[] },
): boolean {
  if (n.module && mark.modules.has(n.module)) return true;
  if (n.kind === "track" && n.module && mark.lanes.has(n.module)) return true;
  if (n.chain && mark.chains.has(n.chain)) return true;
  return !!n.chains?.some((c) => mark.chains.has(c));
}

/** Nothing lit — what the surfaces read while no row is hovered. */
export const isEmptyMark = (m: HistoryMark): boolean =>
  !m.lanes.size && !m.clips.size && !m.chains.size && !m.modules.size;

/** The graph's `marked` prop for `mark`, or none — what each of the three graph hosts hands DomChains. */
export const nodePredicate = (
  mark: HistoryMark | null | undefined,
):
  | ((n: {
      kind: string;
      module?: string;
      chain?: string;
      chains?: string[];
    }) => boolean)
  | undefined => (mark ? (n) => nodeMarked(mark, n) : undefined);
