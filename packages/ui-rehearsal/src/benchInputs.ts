// benchInputs.ts — which interface channel feeds each live input of the bench, chosen from the
// recorder: the bench's graph says which nodes are inputs, and the same `node param` command k7's
// node card sends writes the choice. Remembered per chain in this browser, since every open of the
// bench scaffolds the rig afresh, with no channel. See ../docs/chainSource.md, "Choosing the inputs".

import { ENGINE_TOKEN_HEADER, WORKSPACE_HEADER } from "@studio/web-protocol";
import { BENCH_WORKSPACE } from "@studio/web-protocol/projects";

/** The bench's file service, as the probe of its engine reached it. */
export interface BenchFiles {
  fileBase: string;
  fileToken: string;
}

/** One live input of the bench: its node, and the channels it listens on, null for none yet. */
export interface BenchInput {
  node: string;
  channel: number[] | null;
}

/** The part of the graph read here: an input is the one step that carries `monitor`. */
interface GraphShape {
  chains?: Record<
    string,
    { use?: { module: string; monitor?: string; channel?: number[] }[] }
  >;
}

/** Every input node of the graph, once each, in the order the chains name them. */
export function inputsOf(graph: GraphShape): BenchInput[] {
  const seen = new Map<string, BenchInput>();
  for (const chain of Object.values(graph.chains ?? {}))
    for (const step of chain.use ?? [])
      if (step.monitor !== undefined && !seen.has(step.module))
        seen.set(step.module, {
          node: step.module,
          channel: step.channel?.length ? step.channel : null,
        });
  return [...seen.values()];
}

const headers = (f: BenchFiles): Record<string, string> => ({
  [ENGINE_TOKEN_HEADER]: f.fileToken,
  [WORKSPACE_HEADER]: BENCH_WORKSPACE,
});

/** The bench's inputs; throws while the bench is not open yet, which the caller retries. */
export async function readBenchInputs(f: BenchFiles): Promise<BenchInput[]> {
  const res = await fetch(`${f.fileBase}/graph`, { headers: headers(f) });
  if (!res.ok) throw new Error(`graph: ${res.status}`);
  return inputsOf((await res.json()) as GraphShape);
}

/** The command line that puts `channels` on `node` — k7's node card's own. */
export const channelCommand = (node: string, channels: number[]): string =>
  `node param ${node} @channel ${channels.join(",")}`;

/** Feed `node` from `channels`, 1-based, a pair for a stereo input. */
export async function setBenchChannel(
  f: BenchFiles,
  node: string,
  channels: number[],
): Promise<void> {
  const res = await fetch(`${f.fileBase}/command`, {
    method: "POST",
    headers: { ...headers(f), "content-type": "application/json" },
    body: JSON.stringify({ line: channelCommand(node, channels), want: [] }),
  });
  if (!res.ok) {
    const said = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(said.error ?? `command: ${res.status}`);
  }
}

const KEY = "rehearsal.benchChannels";

/** What this browser chose for `chain`'s inputs, by node. */
export function rememberedChannels(chain: string): Record<string, number[]> {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<
      string,
      Record<string, number[]>
    >;
    return all[chain] ?? {};
  } catch {
    return {};
  }
}

export function rememberChannel(
  chain: string,
  node: string,
  channels: number[],
): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<
      string,
      Record<string, number[]>
    >;
    all[chain] = { ...all[chain], [node]: channels };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // A browser refusing storage asks again on the next open.
  }
}
