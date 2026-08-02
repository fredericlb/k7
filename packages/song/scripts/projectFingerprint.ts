// A project's compiled FINGERPRINT — what a refactor must not change.
//
//   npx tsx packages/song/scripts/projectFingerprint.ts "<project>" [> before.txt]
//
// The goldens cover the two shipped demos; those are small and one level deep. This is
// for a real song: run it before a change and after, and diff. It records what the ENGINE
// would be handed (plugin ids, their type/name, which params and library files each
// carries, the live-input wiring, the sends, the rack sizes) plus every warning the graph
// reports — deliberately not the whole ProjectDoc, so a clip's start time or a colour
// cannot drown the signal.
//
// Absolute paths are blanked: they move between machines and say nothing about the model.

import { relative } from "node:path";
import { loadGraph } from "../src/graph";
import { compileNodeProject } from "../src/nodeProject";

const dir = process.argv[2];
if (!dir) {
  console.error('usage: projectFingerprint "<project dir>"');
  process.exit(2);
}

const ABS = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;
/** An absolute path as its project-relative tail, so a moved checkout still diffs clean. */
const short = (p: unknown): string => {
  const s = String(p ?? "");
  if (!s) return "";
  if (!ABS.test(s)) return s;
  const rel = relative(dir, s).split("\\").join("/");
  return rel.startsWith("..") ? `<abs>/${s.split(/[\\/]/).pop()}` : rel;
};

/** A DSP graph as its SHAPE — node count and param names — so formatting cannot move it. */
const dspShape = (json: string): string => {
  try {
    const g = JSON.parse(json) as {
      nodes?: unknown[];
      params?: Record<string, unknown>;
    };
    return `${g.nodes?.length ?? 0}n/${Object.keys(g.params ?? {})
      .sort()
      .join("+")}`;
  } catch {
    return "unparsable";
  }
};

const doc = compileNodeProject(dir);
const g = loadGraph(dir);
const out: string[] = [];

for (const t of [...doc.tracks].sort((a, b) => a.id.localeCompare(b.id))) {
  const io = [
    t.inputChannels?.length ? `in=[${t.inputChannels.join(",")}]` : "",
    t.monitor && t.monitor !== "auto" ? `monitor=${t.monitor}` : "",
    t.inputGain ? `gain=${t.inputGain}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  out.push(`track ${t.id}${io ? `  ${io}` : ""}`);
  for (const p of t.plugins) {
    // Params by NAME and value: a merge that loses a base's default is exactly the kind
    // of regression this file exists to catch, and the names alone would hide it.
    const params = Object.entries(p.params ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const extra = [
      p.path ? `preset=${short(p.path)}` : "",
      p.irFile ? `ir=${short(p.irFile)}` : "",
      p.namFile ? `nam=${short(p.namFile)}` : "",
      // The GRAPH, not its bytes. A recompile can reformat the JSON without changing a
      // single node, and a byte count reports that as a difference — which is exactly the
      // false alarm this instrument must not raise.
      p.dspGraph ? `dsp=${dspShape(p.dspGraph)}` : "",
      p.rack?.length ? `rack=${p.rack.length}` : "",
      p.enabled === false ? "BYPASSED" : "",
    ]
      .filter(Boolean)
      .join(" ");
    out.push(
      `  plugin ${p.id}  [${p.type}/${p.name}]${extra ? `  ${extra}` : ""}`,
    );
    if (params) out.push(`    params ${params}`);
  }
  for (const s of t.sends ?? []) out.push(`  send -> ${s.to} @${s.level}`);
}

out.push("");
for (const w of [...g.warnings].sort()) out.push(`! ${w}`);
out.push("");
out.push(
  `${doc.tracks.length} tracks, ` +
    `${doc.tracks.reduce((n, t) => n + t.plugins.length, 0)} plugins, ` +
    `${g.warnings.length} warnings`,
);

console.log(out.join("\n"));
