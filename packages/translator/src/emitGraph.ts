// emitGraph.ts — the ROUTING an import writes: one chain per source track, its plugins as steps, a
// strip last on every lane, a stand-in instrument where none crossed over, and graph.yaml.
// graph.yaml holds SEGMENTS, so a send's LEVEL is lost on the way — docs/import.md.

import { join } from "node:path";
import { SHARED_STRIP } from "@studio/song/scaffoldLive";
import { MIX_NODE, OUT_NODE } from "@studio/song-schema/moduleTypes";
import { moduleRefFor, orderPlugins } from "./emitModules.js";
import {
  type ChainDef,
  type EmitCtx,
  type OutDef,
  writeFile,
  yamlText,
} from "./emitNaming.js";
import type { PluginOut } from "./model.js";

/** What a MIDI lane plays when its own instrument could not cross over — a drum rack, and the rest. */
const STAND_IN_KIT = "@k7-core/instruments/k7-rack";
const STAND_IN_SYNTH = "@k7-core/instruments/synth/surge-xt";

// Keep the first mention of each destination (a track's dry output + its sends).
export function dedupeOuts(outs: OutDef[]): OutDef[] {
  const seen = new Set<string>();
  return outs.filter((o) => {
    if (seen.has(o.to)) return false;
    seen.add(o.to);
    return true;
  });
}

/** The chains as SEGMENTS — who feeds whom, which is how the imported sends survive; docs/import.md. */
function chainSegments(chains: Record<string, ChainDef>): {
  tracks: Record<string, string[]>;
  modules: Record<string, string[]>;
  bypassed: string[];
} {
  const tracks: Record<string, string[]> = {};
  const modules: Record<string, string[]> = {};
  const bypassed: string[] = [];

  const entryOf = (name: string, seen = new Set<string>()): string | null => {
    const d = chains[name];
    if (!d || seen.has(name)) return name; // a sink (OUT), or a module — either way, itself
    seen.add(name);
    if (d.use.length) return d.use[0].module;
    const next = d.out[0]?.to;
    return next ? entryOf(next, seen) : null;
  };
  const link = (
    into: Record<string, string[]>,
    node: string,
    tos: (string | null)[],
  ) => {
    into[node] ??= [];
    const list = into[node];
    for (const to of tos) if (to && !list.includes(to)) list.push(to);
  };

  for (const d of Object.values(chains)) {
    const path = d.use.map((s) => s.module);
    const ends = d.out.map((o) => entryOf(o.to));
    if (d.from) link(tracks, d.from, path.length ? [path[0]] : ends);
    else if (path.length) link(modules, path[0], []); // a bus's first node exists before anything feeds it
    for (let i = 0; i < path.length; i++)
      link(modules, path[i], i + 1 < path.length ? [path[i + 1]] : ends);
    for (const s of d.use)
      if (s.enabled === false || d.enabled === false) bypassed.push(s.module);
  }
  return { tracks, modules, bypassed };
}

/** A lane's strip, last in its run: a node on the LIBRARY's mixer (`SHARED_STRIP`) — packages/song/docs/liveProject.md. */
function addTrackMixer(ctx: EmitCtx, entry: string): string {
  const { usedChainNames, usedNodeNames } = ctx;
  let name = `mix-${entry}`;
  for (
    let n = 2;
    usedChainNames.has(name.toLowerCase()) ||
    usedNodeNames.has(name.toLowerCase());
    n++
  )
    name = `mix-${entry}-${n}`;
  usedChainNames.add(name.toLowerCase());
  usedNodeNames.add(name.toLowerCase());
  writeFile(
    join(ctx.outDir, `nodes/${name}.yaml`),
    `# ${entry}'s strip: volume, pan and three bands, and the one place its level lives.\n` +
      `#\n` +
      `# Written by the import, because a lane without one plays at unity with nowhere to put a\n` +
      `# level — see packages/song/docs/trackMixer.md.\n` +
      `extends: ${JSON.stringify(SHARED_STRIP)}\n`,
  );
  // Not counted in `nodeFiles`: that stat is one node per plugin USE, and a strip is neither.
  return name;
}

/** A library instrument standing in for one that did not cross over: the SFZ kit for drums, else the synth. */
function addStandIn(ctx: EmitCtx, entry: string, drums: boolean): string {
  const { usedChainNames, usedNodeNames } = ctx;
  let name = `${entry}-instrument`;
  for (
    let n = 2;
    usedChainNames.has(name.toLowerCase()) ||
    usedNodeNames.has(name.toLowerCase());
    n++
  )
    name = `${entry}-instrument-${n}`;
  usedNodeNames.add(name.toLowerCase());
  writeFile(
    join(ctx.outDir, `nodes/${name}.yaml`),
    `# ${entry}'s instrument, a STAND-IN: the source project's could not be carried over, so the\n` +
      `# import put a library one here — replace it with the instrument this part was written for.\n` +
      `extends: ${JSON.stringify(drums ? STAND_IN_KIT : STAND_IN_SYNTH)}\n`,
  );
  ctx.standIns++;
  return name;
}

/** One chain per source: its ordered plugins become `use` steps, each naming a module node, routed to `terminal`. */
export function addChain(
  ctx: EmitCtx,
  entry: string,
  fromTrack: string | undefined,
  plugins: PluginOut[],
  terminal: OutDef[],
  standIn?: { drums: boolean },
): void {
  ctx.usedChainNames.add(entry.toLowerCase());
  const use = orderPlugins(plugins).map((p) => ({
    // The chain names a NODE; collapseSoleInserts rewrites it to the bare module when the plugin is used once.
    module: moduleRefFor(ctx, p, entry),
    enabled: p.enabled ? undefined : false,
  }));
  // The stand-in leads, where the instrument the source had would have stood.
  if (standIn)
    use.unshift({
      module: addStandIn(ctx, entry, standIn.drums),
      enabled: undefined,
    });
  // A LANE gets its strip, last; a return bus and the master chain are not lanes and get none.
  if (fromTrack)
    use.push({ module: addTrackMixer(ctx, entry), enabled: undefined });
  ctx.chains[entry] = { from: fromTrack, use, out: terminal };
}

/** Drop dead return buses — a bus nothing routes into is unfed. Cascades, since one may feed another. */
export function dropDeadBuses(ctx: EmitCtx): void {
  const { chains, busChains } = ctx;
  for (let changed = true; changed; ) {
    changed = false;
    const routedInto = new Set<string>();
    for (const d of Object.values(chains))
      for (const o of d.out) routedInto.add(o.to);
    for (const name of [...busChains])
      if (!routedInto.has(name)) {
        delete chains[name];
        busChains.delete(name);
        changed = true;
      }
  }
}

/** graph.yaml, read AFTER the collapse, which may have renamed the master run's first step onto its module. */
export function writeGraph(ctx: EmitCtx, masterChain?: string): void {
  const { chains, song, slugOf, busChains } = ctx;
  const {
    tracks: chainTracks,
    modules: chainModules,
    bypassed,
  } = chainSegments(chains);
  const weighted = Object.values(chains).reduce(
    (n, d) => n + d.out.filter((o) => o.gain != null && o.gain !== 1).length,
    0,
  );
  // What the sum runs into: the master run's FIRST module, or `OUT` when nothing treats the whole (docs/masterChain.md).
  const mixSink =
    (masterChain ? chains[masterChain]?.use[0]?.module : undefined) ?? OUT_NODE;
  // ONE map, lanes first and `MIX` last, so the file reads the way the signal flows — packages/song/docs/trackModules.md.
  const chainNodes = { ...chainTracks, ...chainModules, [MIX_NODE]: [mixSink] };
  const seg: Record<string, unknown> = {};
  if (Object.keys(chainNodes).length) seg.modules = chainNodes;
  // A lane the import found MUTED is bypassed, which is where a lane's mute lives.
  const muted = song.tracks
    .filter(
      (t) =>
        t.mute &&
        slugOf.has(t.id) &&
        !busChains.has(slugOf.get(t.id) as string),
    )
    .map((t) => slugOf.get(t.id) as string);
  const allBypassed = [...bypassed, ...muted];
  if (allBypassed.length) seg.bypassed = allBypassed;
  writeFile(
    join(ctx.outDir, "graph.yaml"),
    yamlText(
      seg,
      [],
      weighted
        ? `NOTE: ${weighted} weighted send(s) arrived at full level — a destination says\n` +
            `WHERE the signal goes, not how much of it. Trim them on the bus's own module.`
        : undefined,
      // One node per line, its destinations a flow sequence — the canonical form.
      [...Object.keys(chainNodes).map((k) => ["modules", k]), ["bypassed"]],
    ),
  );
}
