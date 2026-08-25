// A project's compiled FINGERPRINT — what a refactor must not change.
//
//   npx tsx packages/song/scripts/projectFingerprint.ts "<project>" [> before.txt]
//
// The goldens cover the two shipped demos, which are small and one level deep; this is for a real
// song — run it before a change and after, then diff. It records what the ENGINE would be handed
// plus every graph warning, deliberately NOT the whole ProjectDoc, so a clip's start time cannot
// drown the signal. Absolute paths are blanked: they move between machines.

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
    t.outputChannels?.length ? `out=[${t.outputChannels.join(",")}]` : "",
    t.monitor && t.monitor !== "auto" ? `monitor=${t.monitor}` : "",
    t.inputGain ? `gain=${t.inputGain}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  out.push(`track ${t.id}${io ? `  ${io}` : ""}`);
  for (const p of t.plugins) {
    // By NAME and value: names alone would hide a merge losing a base's default.
    const params = Object.entries(p.params ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    const extra = [
      p.path ? `preset=${short(p.path)}` : "",
      p.irFile ? `ir=${short(p.irFile)}` : "",
      p.namFile ? `nam=${short(p.namFile)}` : "",
      // The GRAPH, not its bytes: a reformat with no node changed must not read as a difference.
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
