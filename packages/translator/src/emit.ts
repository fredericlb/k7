// emit.ts — write a Song (from any mapper) out as a node/lane/chain project: a
// project.k7x + graph.k7x, one self-contained module folder per plugin, and
// nodes/clips/sequences. No schema file ships with it — a project is validated in
// process against the loader's own schemas. Layout + mapping: docs/import.md.
// The parts share one EmitCtx: emitGraph.ts (routing), emitModules.ts (plugins), emitAudio.ts (material).

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MIX_NODE, OUT_NODE } from "@studio/song-schema/moduleTypes";
import { emitArrangement, trackValue } from "./emitAudio.js";
import {
  addChain,
  dedupeOuts,
  dropDeadBuses,
  writeGraph,
} from "./emitGraph.js";
import {
  collapseSoleInserts,
  dropOrphanInserts,
  orderPlugins,
  writeModules,
} from "./emitModules.js";
import { newEmitCtx, type OutDef, writeDoc } from "./emitNaming.js";
import type { Song } from "./model.js";

export interface EmitStats {
  trackFiles: number;
  clipFiles: number;
  sequenceFiles: number;
  chainFiles: number;
  moduleNodes: number; // module.k7x files written under modules/<type>/
  // nodes/<name>.k7x files — one per use of a plugin used more than once (see ModuleDef).
  nodeFiles: number;
  modulePresetFiles: number; // .vstpreset files, beside the node or module whose state they are
  missingAudio: string[];
  missingPlugins: string[]; // referenced but not in the k7 cache -> stubbed
  standIns: number; // MIDI lanes given a library instrument in place of one that did not cross over
  // Tracks given both audio and MIDI: they import as "sequences", and their audio won't load until split by hand.
}

export function emitFolder(
  outDir: string,
  song: Song,
  assets: Record<string, Uint8Array>,
  // The plugin scan to check names against. Defaults to this machine's; a test names its own.
  extsFile?: string,
): EmitStats {
  mkdirSync(outDir, { recursive: true });
  // OUT needs no module of its own — a built-in sink name, docs/moduleTypes.md ("The five built-in outputs").
  const ctx = newEmitCtx(outDir, song, assets);
  const { slugOf } = ctx;

  // Master → OUT (or a master chain if it carries plugins).
  const master = song.tracks.find((t) => t.role === "master");
  const masterPlugins = orderPlugins(master?.plugins ?? []);
  // Where a lane ends: the mixer's SUM, like every k7 project (packages/song/docs/masterChain.md).
  const masterSink = MIX_NODE;
  /** The master chain's own name, when the master track carries plugins — what `MIX` runs into. */
  const masterChain =
    master && masterPlugins.length ? slugOf.get(master.id) : undefined;

  let trackFiles = 0;
  for (const t of song.tracks) {
    if (t.role === "master") continue; // handled below
    const slug = slugOf.get(t.id) as string;
    const isBus = t.role === "effect"; // a return bus: no clips, fed by sends

    // Dry output goes to the master at full gain; each enabled send fans out to its bus at the send's level.
    const sendTargets: OutDef[] = (t.sends ?? [])
      .filter((s) => s.enabled)
      .map((s): OutDef => ({ to: slugOf.get(s.to) ?? s.to, gain: s.level }))
      .filter((o) => !!o.to);
    const terminal = dedupeOuts([{ to: masterSink }, ...sendTargets]);

    // Audio and no MIDI means a bounced track: drop its instrument/note FX (the frozen remains), keep the audio FX.
    const clips = t.clips ?? [];
    const audioSource =
      !isBus &&
      clips.some((c) => c.type !== "midi") &&
      !clips.some((c) => c.type === "midi");
    const plugins = audioSource
      ? (t.plugins ?? []).filter(
          (p) => p.role !== "instrument" && p.role !== "noteFX",
        )
      : (t.plugins ?? []);

    // Notes and nothing to play them: the instrument stayed behind in the source DAW.
    const needsInstrument =
      !isBus &&
      clips.some((c) => c.type === "midi") &&
      !plugins.some((p) => p.role === "instrument");
    addChain(
      ctx,
      slug,
      isBus ? undefined : slug,
      plugins,
      terminal,
      needsInstrument ? { drums: !!t.drums } : undefined,
    );
    if (isBus) ctx.busChains.add(slug);

    if (!isBus) {
      writeDoc(
        join(outDir, `nodes/${slug}.k7x`),
        trackValue(t, emitArrangement(ctx, t, slug)),
        { itemsOneLine: [["events"]] },
      );
      trackFiles++;
    }
  }

  // Master chain (only if it has plugins; else `MIX` and `OUT` are a single wire).
  if (master && masterPlugins.length)
    addChain(ctx, slugOf.get(master.id) as string, undefined, masterPlugins, [
      { to: OUT_NODE },
    ]);

  dropDeadBuses(ctx);
  dropOrphanInserts(ctx);
  collapseSoleInserts(ctx);
  writeGraph(ctx, masterChain);
  const moduleStats = writeModules(ctx, extsFile);

  const p = song.project;
  writeDoc(join(outDir, "project.k7x"), {
    project: {
      name: p.name,
      tempo: p.tempo,
      sampleRate: p.sampleRate,
      timeSignature: p.timeSignature,
    },
  });

  // The surface an imported project needs to be LOOKED at — an arrangement (packages/song/docs/surfaces.md).
  writeDoc(
    join(outDir, "surfaces/timeline.k7x"),
    { type: "timeline", layout: "split" },
    {
      note:
        "The ARRANGEMENT — the timeline, and the transport that rolls through it.\n\n" +
        "Written by the import: what a .dawproject or .als carries is lanes on a ruler, so the\n" +
        "project that comes out of one draws them. Delete this file and the song still compiles\n" +
        "and still plays; you simply have no lanes on screen.",
    },
  );

  // No format pass: the emitter's output is canonical as written.

  return {
    trackFiles,
    clipFiles: ctx.clipFiles,
    sequenceFiles: ctx.sequenceFiles,
    chainFiles: Object.keys(ctx.chains).length,
    moduleNodes: moduleStats.moduleNodes,
    nodeFiles: moduleStats.nodeFiles,
    modulePresetFiles: moduleStats.modulePresetFiles,
    missingAudio: ctx.missingAudio,
    missingPlugins: moduleStats.missingPlugins,
    standIns: ctx.standIns,
  };
}
