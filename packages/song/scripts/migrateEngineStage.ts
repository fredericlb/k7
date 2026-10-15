// migrateEngineStage.ts — hand a module's blend and levels to the engine's own stage (engine/k7-runtime/docs/mix.md).
//
//   npx tsx packages/song/scripts/migrateEngineStage.ts <dir> [more dirs…] [--write]
//
// Dry by default. A Fade's `Mix` becomes `Level`; an effect's own dry/wet/mix becomes `mix:`, its own
// input/output level `input_volume:`/`output_volume:`; a mapping follows; `@volume` is `@output-volume`.
// The one thing a reader would get wrong: classification follows `extends` by NAME, file to file.

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, sep } from "node:path";
import { builtinPluginForRef } from "@studio/song-schema/builtinParams";
import { ownLevelSide, ownMixSide } from "@studio/song-schema/moduleTypes";
import { isMap, isScalar, parseDocument, Scalar, type YAMLMap } from "yaml";

const args = process.argv.slice(2);
const write = args.includes("--write");
const roots = args.filter((a) => !a.startsWith("--"));
if (!roots.length) {
  console.error(
    "usage: migrateEngineStage <dir> [more dirs…] [--write]   (dry run without --write)",
  );
  process.exit(2);
}

// --- the files ------------------------------------------------------------------

function* walk(dir: string): Generator<string> {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (
      name === "node_modules" ||
      name === ".git" ||
      name === "_history" ||
      name === "_recycle_bin"
    )
      continue;
    const p = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = [...new Set(roots.flatMap((r) => [...walk(r)]))];
const yamlFiles = files.filter((f) => /\.ya?ml$/i.test(f));
const docs = new Map<string, ReturnType<typeof parseDocument>>();
const docOf = (f: string) => {
  let d = docs.get(f);
  if (!d) {
    d = parseDocument(readFileSync(f, "utf8"), { version: "1.2" });
    docs.set(f, d);
  }
  return d;
};
const dirty = new Set<string>();
const report: string[] = [];
const say = (f: string, what: string) => report.push(`${f}\n    ${what}`);

// Every module folder by the path a ref spells under its level: `audio/utility/fade`.
const moduleFolders = new Map<string, string>();
for (const f of yamlFiles) {
  if (!/^module\.ya?ml$/i.test(basename(f))) continue;
  const parts = dirname(f).split(sep);
  const at = parts.findLastIndex((p) => p === "modules" || p === "_modules");
  if (at >= 0) moduleFolders.set(parts.slice(at + 1).join("/"), f);
}

// --- what a file IS ---------------------------------------------------------------

interface Shape {
  plugin?: string; // the plugin name, nearest first
  category?: string; // the type folder of the module it comes down to
  inputs?: number; // declared inputs, nearest first
  engineRef?: string; // an `@engine/…` it ends on
  jsdspJson?: string; // the jsdsp.json whose param ranges are known
}

function refTarget(ref: string, from: string): string | undefined {
  if (ref.startsWith("@engine/")) return undefined;
  // `@k7-core/audio/x`, `@workspace/audio/x`, `audio/x`: the path under a level.
  const tail = ref.replace(/^@[^/]+\//, "");
  const hit = moduleFolders.get(tail);
  if (hit) return hit;
  // A node extending another node of its own project.
  const sibling = join(dirname(from), `${tail}.yaml`);
  return files.includes(sibling) ? sibling : undefined;
}

function shapeOf(f: string, seen = new Set<string>()): Shape {
  if (seen.has(f)) return {};
  seen.add(f);
  const d = docOf(f).toJS() as Record<string, unknown> | null;
  const own: Shape = {};
  const plugin = (d?.plugin as { name?: unknown } | undefined)?.name;
  if (typeof plugin === "string") own.plugin = plugin;
  if (Array.isArray(d?.inputs)) own.inputs = d.inputs.length;
  const parts = dirname(f).split(sep);
  const at = parts.findLastIndex((p) => p === "modules" || p === "_modules");
  if (/^module\.ya?ml$/i.test(basename(f)) && at >= 0) {
    own.category = parts[at + 1];
    const json = join(dirname(f), "jsdsp.json");
    if (files.includes(json)) own.jsdspJson = json;
  }
  const ext = typeof d?.extends === "string" ? d.extends : "";
  if (!ext) return own;
  if (ext.startsWith("@engine/")) return { engineRef: ext, ...own };
  const target = refTarget(ext, f);
  const up = target ? shapeOf(target, seen) : {};
  return {
    plugin: own.plugin ?? up.plugin,
    category: own.category ?? up.category,
    inputs: own.inputs ?? up.inputs,
    engineRef: up.engineRef,
    jsdspJson: own.jsdspJson ?? up.jsdspJson,
  };
}

const isFade = (s: Shape) => s.plugin === "Fade";

/** The module's type folder, off the files or the engine's table; "unknown" when neither says. */
function categoryOf(s: Shape): string {
  if (s.category) return s.category;
  const b = s.engineRef ? builtinPluginForRef(s.engineRef) : undefined;
  if (!b) return "unknown";
  return b.role === "audioEffect"
    ? "audio"
    : b.role === "instrument"
      ? "instruments"
      : "other";
}

/** The compile's own test, read off the files: an effect with at most one declared input. */
function ownsBlend(s: Shape): boolean | "unknown" {
  if (isFade(s)) return false;
  const category = categoryOf(s);
  if (category === "unknown") return "unknown";
  return category === "audio" && (s.inputs ?? 1) <= 1;
}

/** …and which of the two LEVELS the engine sets on it: in on an audio module, out on anything with audio out. */
function takesLevel(s: Shape, side: "input" | "output"): boolean | "unknown" {
  const category = categoryOf(s);
  if (category === "unknown") return "unknown";
  return side === "input"
    ? category === "audio"
    : category === "audio" || category === "instruments";
}

/** A plugin's own level as dB against its neutral: a dB range read as an offset, a linear one as a ratio. */
function levelDb(s: Shape, name: string, value: number): number {
  const r = rangeOf(s, name);
  const raw =
    r.min < 0
      ? value - (r.def ?? 0)
      : value <= 0
        ? -60
        : 20 * Math.log10(value / (r.def && r.def > 0 ? r.def : r.max || 1));
  return Math.round(Math.min(12, Math.max(-60, raw)) * 10) / 10;
}

/** A plugin's own input/output level, in `params:` and in each alternative, becomes that level's `input_volume:`/`output_volume:`. */
function moveOwnLevels(f: string, s: Shape): void {
  const d = docOf(f);
  const levels: { path: (string | number)[]; label: string }[] = [
    { path: [], label: "" },
  ];
  const alts = d.get("alternatives", true);
  if (alts && "items" in alts)
    (alts.items as unknown[]).forEach((_, i) =>
      levels.push({ path: ["alternatives", i], label: ` (alternative ${i})` }),
    );
  for (const { path, label } of levels) {
    const params = d.getIn([...path, "params"], true);
    if (!isMap(params)) continue;
    for (const item of [...params.items]) {
      const k = isScalar(item.key) ? String(item.key.value) : "";
      const side = ownLevelSide(k);
      const v = isScalar(item.value) ? Number(item.value.value) : Number.NaN;
      if (!side || !Number.isFinite(v) || takesLevel(s, side) !== true)
        continue;
      const field = `${side}_volume`;
      const db = levelDb(s, k, v);
      d.deleteIn([...path, "params", k]);
      const had = d.getIn([...path, field]);
      if (had === undefined && db !== 0) d.setIn([...path, field], db);
      dirty.add(f);
      say(
        f,
        `${k}: ${v} -> ${had !== undefined ? `dropped, keeping its ${field}: ${had}` : db !== 0 ? `${field}: ${db}` : `0 dB (no ${field}: line)`}${label}`,
      );
    }
    if (!(params.items.length > 0)) d.deleteIn([...path, "params"]);
  }
}

// --- the value `mix:` takes ------------------------------------------------------------

interface Range {
  min: number;
  max: number;
  def?: number;
}

function rangeOf(s: Shape, name: string): Range {
  if (s.jsdspJson) {
    const j = JSON.parse(readFileSync(s.jsdspJson, "utf8")) as {
      params?: { name: string; min: number; max: number; default?: number }[];
    };
    const p = j.params?.find((x) => x.name === name);
    if (p) return { min: p.min, max: p.max, def: p.default };
  }
  const b = s.engineRef ? builtinPluginForRef(s.engineRef) : undefined;
  const p = b?.params.find((x) => x.name === name);
  if (p) return { min: p.min, max: p.max, def: p.def };
  // Tracktion's own dry/wet on any external plugin: all wet, no dry.
  return { min: 0, max: 1, def: ownMixSide(name) === "dry" ? 0 : 1 };
}

const norm = (v: number, r: Range) =>
  r.max === r.min ? 0 : Math.min(1, Math.max(0, (v - r.min) / (r.max - r.min)));

/** One `mix:` from the plugin's own blend params, and how much LOUDER or quieter the result plays, in dB. */
function mixFrom(
  s: Shape,
  own: Record<string, number>,
): { mix: number; db: number } {
  const names = Object.keys(own);
  const wetName = names.find((n) => ownMixSide(n) === "wet");
  const dryName = names.find((n) => ownMixSide(n) === "dry");
  const wet = wetName ? norm(own[wetName], rangeOf(s, wetName)) : undefined;
  const dry = dryName ? norm(own[dryName], rangeOf(s, dryName)) : undefined;
  // A proportion (`Mix`, `Dry/wet`) is a position already: the level does not move.
  if (wet !== undefined && dry === undefined && !/level/i.test(wetName ?? ""))
    return { mix: round(wet), db: 0 };
  // Two LEVELS, or one beside the other's default: the angle is the blend, the length the loudness it loses.
  const w = wet ?? norm(rangeOf(s, "Wet Level").def ?? 1, { min: 0, max: 1 });
  const d = dry ?? norm(rangeOf(s, "Dry Level").def ?? 0, { min: 0, max: 1 });
  const length = Math.hypot(w, d);
  return {
    mix: round(Math.atan2(w, d) / (Math.PI / 2)),
    db: length > 0 ? round(-20 * Math.log10(length)) : 0,
  };
}
const round = (x: number) => Math.round(x * 1000) / 1000;

// --- the rewrites ---------------------------------------------------------------------

function renameKey(map: YAMLMap, from: string, to: string): boolean {
  for (const item of map.items)
    if (isScalar(item.key) && item.key.value === from) {
      item.key = new Scalar(to);
      return true;
    }
  return false;
}

/** A Fade's `Mix` becomes `Level` wherever the Fade is defined or used. */
function renameFade(f: string): void {
  const d = docOf(f);
  const params = d.get("params", true);
  if (isMap(params) && renameKey(params, "Mix", "Level")) {
    dirty.add(f);
    say(f, "Fade: params Mix -> Level");
  }
  if (!/^module\.ya?ml$/i.test(basename(f))) return;
  // The module folder itself: its panel, its DSP source and its compiled graph.
  const folder = dirname(f);
  const ui = join(folder, "ui.yaml");
  if (files.includes(ui)) {
    const text = readFileSync(ui, "utf8");
    const next = text
      .replace(/\bbind: Mix\b/g, "bind: Level")
      .replace(/\blabel: Mix\b/g, "label: Level");
    if (next !== text) textEdits.set(ui, next);
  }
  const ts = join(folder, "jsdsp.ts");
  if (files.includes(ts)) {
    const text = readFileSync(ts, "utf8");
    const next = text.replace(/g\.param\("Mix"/g, 'g.param("Level"');
    if (next !== text) textEdits.set(ts, next);
  }
  const json = join(folder, "jsdsp.json");
  if (files.includes(json)) {
    const text = readFileSync(json, "utf8");
    const next = text.replace(/"Mix"/g, '"Level"');
    if (next !== text) textEdits.set(json, next);
  }
  for (const p of [ui, ts, json])
    if (textEdits.has(p)) say(p, "Fade: Mix -> Level");
}
const textEdits = new Map<string, string>();

/** An effect's own blend params, in `params:` and in each alternative, become that level's `mix:`. */
function moveOwnMix(f: string, s: Shape): void {
  const d = docOf(f);
  const levels: { path: (string | number)[]; label: string }[] = [
    { path: [], label: "" },
  ];
  const alts = d.get("alternatives", true);
  if (alts && "items" in alts)
    (alts.items as unknown[]).forEach((_, i) =>
      levels.push({ path: ["alternatives", i], label: ` (alternative ${i})` }),
    );
  for (const { path, label } of levels) {
    const params = d.getIn([...path, "params"], true);
    if (!isMap(params)) continue;
    const own: Record<string, number> = {};
    for (const item of params.items) {
      const k = isScalar(item.key) ? String(item.key.value) : "";
      const v = isScalar(item.value) ? Number(item.value.value) : Number.NaN;
      if (ownMixSide(k) && Number.isFinite(v)) own[k] = v;
    }
    const names = Object.keys(own);
    if (!names.length) continue;
    const { mix, db } = mixFrom(s, own);
    for (const n of names) d.deleteIn([...path, "params", n]);
    if (!(params.items.length > 0)) d.deleteIn([...path, "params"]);
    const had = d.getIn([...path, "mix"]);
    if (had === undefined && mix < 1) d.setIn([...path, "mix"], mix);
    dirty.add(f);
    say(
      f,
      `${names.map((n) => `${n}: ${own[n]}`).join(", ")} -> ${
        had !== undefined
          ? `dropped, keeping its mix: ${had}`
          : mix < 1
            ? `mix: ${mix}`
            : "all wet (no mix: line)"
      }${label}${Math.abs(db) >= 0.1 ? ` — plays ${db > 0 ? "+" : ""}${db} dB against today` : ""}`,
    );
  }
}

/** What a node NAME in a mapping resolves to: the node file beside the mapping's project or assembly. */
function nodeFile(from: string, node: string): string | undefined {
  let dir = dirname(from);
  for (let i = 0; i < 4; i++) {
    for (const cand of [
      join(dir, "nodes", `${node}.yaml`),
      join(dir, "instances", `${node}.yaml`),
    ])
      if (files.includes(cand)) return cand;
    dir = dirname(dir);
  }
  return undefined;
}

/** A mapping's `param: Mix` follows the node it names: `Level` on a Fade, `@mix` on an effect that owns its blend. */
function remap(f: string, binding: unknown, path: (string | number)[]): void {
  if (!isMap(binding)) return;
  const node = binding.get("module") ?? binding.get("node");
  const param = binding.get("param");
  if (
    typeof node === "string" &&
    typeof param === "string" &&
    ownMixSide(param)
  ) {
    const target = nodeFile(f, node);
    const s = target ? shapeOf(target) : undefined;
    const to = s
      ? isFade(s)
        ? param === "Mix"
          ? "Level"
          : undefined
        : ownsBlend(s) === true
          ? "@mix"
          : undefined
      : undefined;
    if (to) {
      docOf(f).setIn([...path, "param"], to);
      dirty.add(f);
      say(f, `${path.join(".")}: ${node}.${param} -> ${to}`);
    }
  }
  const also = binding.get("also", true);
  if (also) remap(f, also, [...path, "also"]);
}

// --- run ------------------------------------------------------------------------------

const unknown: string[] = [];
for (const f of yamlFiles) {
  let d: ReturnType<typeof parseDocument>;
  try {
    d = docOf(f);
  } catch {
    continue;
  }
  if (d.errors.length) continue;
  const js = d.toJS() as Record<string, unknown> | null;
  if (!js || typeof js !== "object") continue;
  // A surface's mapping, or an assembly's promoted params: the places a NAME points at a node's param.
  const mapping = d.get("mapping", true);
  if (isMap(mapping))
    for (const item of mapping.items)
      if (isScalar(item.key))
        remap(f, item.value, ["mapping", String(item.key.value)]);
  if (basename(f).startsWith("assembly.")) {
    const params = d.get("params", true);
    if (isMap(params))
      for (const item of params.items)
        if (isScalar(item.key))
          remap(f, item.value, ["params", String(item.key.value)]);
    continue;
  }
  if (!("extends" in js) && !("plugin" in js)) continue;
  const s = shapeOf(f);
  if (isFade(s)) {
    renameFade(f);
    continue;
  }
  const hasOwn = [
    js.params,
    ...((js.alternatives as { params?: unknown }[]) ?? []).map(
      (a) => a?.params,
    ),
  ]
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .flatMap((p) => Object.keys(p));
  const hasMix = hasOwn.some((k) => ownMixSide(k));
  const hasLevel = hasOwn.some((k) => ownLevelSide(k));
  if (!hasMix && !hasLevel) continue;
  if (categoryOf(s) === "unknown") {
    unknown.push(f);
    continue;
  }
  if (hasMix && ownsBlend(s) === true) moveOwnMix(f, s);
  if (hasLevel) moveOwnLevels(f, s);
}

// The lane's fader is `@output-volume` now: every QUOTED `@volume` — a bind, a MIDI map's key, a mapping's param.
const VOLUME_TOKEN = /(["'])@volume\1/g;
const renamed = new Map<string, string>();
for (const f of yamlFiles) {
  const text = dirty.has(f)
    ? docOf(f).toString({ lineWidth: 0 })
    : (() => {
        try {
          return readFileSync(f, "utf8");
        } catch {
          return "";
        }
      })();
  if (!VOLUME_TOKEN.test(text)) continue;
  VOLUME_TOKEN.lastIndex = 0;
  renamed.set(f, text.replace(VOLUME_TOKEN, "$1@output-volume$1"));
  say(f, "@volume -> @output-volume");
}

for (const line of report) console.log(line);
if (unknown.length) {
  console.log(
    "\nCOULD NOT TELL — sets a dry/wet/mix or a level but its module is not among these files (an external plugin, or a library not given):",
  );
  for (const f of unknown) console.log(`  ${f}`);
}
const changed = new Set([...dirty, ...textEdits.keys(), ...renamed.keys()]);
console.log(
  `\n${changed.size} file(s) ${write ? "rewritten" : "would change — run again with --write"}`,
);
if (write) {
  for (const f of dirty)
    if (!renamed.has(f)) writeFileSync(f, docOf(f).toString({ lineWidth: 0 }));
  for (const [f, text] of textEdits) writeFileSync(f, text);
  for (const [f, text] of renamed) writeFileSync(f, text);
}
