// checkPanelBinds.ts — every control a library panel binds, checked against the parameters its plugin
// REALLY exposes to the engine. A bind the plugin does not have is a control that moves and does
// nothing: the engine drops the value with a warning nobody sees. Built-ins read the generated list;
// an external is instantiated by the engine's own `--dump-params-ext`, so this runs only where the
// plugin is installed. See packages/song/docs/panelBinds.md.
//
// npx tsx packages/song/scripts/checkPanelBinds.ts [library root] [--only <name filter>] [--json]

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { builtinPluginFor } from "@studio/song-schema/builtinParams";
import {
  engineModuleOf,
  FILE_PARAMS,
  LIBRARY_FILE_PARAMS,
} from "@studio/song-schema/moduleTypes";
import { parse as parseYaml } from "yaml";
import { scannedPlugins } from "../src/engineCatalogue";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const only = flag("--only")?.toLowerCase();
const asJson = args.includes("--json");
const root = resolve(
  args.find((a) => !a.startsWith("--")) ?? join(REPO, "st0-library"),
);
const modulesRoot = join(root, "modules");

/** The engine binary: `$ST0_ENGINE`, else the first build preset that has one. */
function engineBinary(): string {
  if (process.env.ST0_ENGINE) return process.env.ST0_ENGINE;
  const build = join(REPO, "engine/st0-engine/build");
  for (const p of [
    "macos-clang",
    "windows-msvc/RelWithDebInfo",
    "dev-gcc",
    "dev-clang",
  ])
    for (const exe of ["st0-engine", "st0-engine.exe"]) {
      const f = join(build, p, exe);
      if (existsSync(f)) return f;
    }
  throw new Error("no st0-engine build found — set ST0_ENGINE");
}

type Plugin = { type: string; name: string };
type Yaml = Record<string, unknown>;

const readYaml = (f: string): Yaml =>
  existsSync(f)
    ? ((parseYaml(readFileSync(f, "utf8"), { version: "1.2" }) ?? {}) as Yaml)
    : {};

/** Every folder under the library that holds a module.yaml, keyed by the `@<lib>/…` ref it answers to. */
function moduleFolders(): Map<string, string> {
  const ns =
    root.split(sep).pop() === "st0-library"
      ? "st0"
      : (root.split(sep).pop() ?? "st0");
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (!statSync(p).isDirectory()) continue;
      if (existsSync(join(p, "module.yaml")))
        out.set(`@${ns}/${relative(modulesRoot, p).split(sep).join("/")}`, p);
      walk(p);
    }
  };
  walk(modulesRoot);
  return out;
}

const folders = moduleFolders();
// The scan, by the `@engine/<slug>` ref each plugin answers to — the same rule the compile uses.
const scanned = new Map<string, Plugin>();
for (const p of scannedPlugins()) {
  const m = engineModuleOf(p);
  if (m && !scanned.has(m.ref)) scanned.set(m.ref, m.plugin);
}

/** The plugin a module folder ends up running: its own `plugin:`, else whatever its `extends:` chain names. */
function pluginOf(folder: string, seen = new Set<string>()): Plugin | null {
  if (seen.has(folder)) return null;
  seen.add(folder);
  const m = readYaml(join(folder, "module.yaml"));
  const own = m.plugin as Plugin | undefined;
  if (own?.type && own.name)
    return { type: String(own.type), name: String(own.name) };
  const ref = typeof m.extends === "string" ? m.extends : "";
  if (ref.startsWith("@engine/")) return scanned.get(ref) ?? null;
  const next = folders.get(ref);
  return next ? pluginOf(next, seen) : null;
}

// A FILE a plugin loads when it is built (a model, an IR), set as a field and never as a number.
const FILE_BINDS = new Set<string>([
  ...FILE_PARAMS,
  ...Object.keys(LIBRARY_FILE_PARAMS),
]);

/** Every param name a panel binds, wherever it sits — widgets, tabs, a crossfade's `pair`. `@` names are the engine's. */
function bindsOf(ui: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(ui)) for (const v of ui) bindsOf(v, out);
  else if (ui && typeof ui === "object")
    for (const [k, v] of Object.entries(ui)) {
      if (
        (k === "bind" || k === "pair") &&
        typeof v === "string" &&
        !v.startsWith("@") &&
        !FILE_BINDS.has(v)
      )
        // Exact, as the engine matches: a name some plugins end with a space is quoted that way in the panel.
        out.add(v);
      else bindsOf(v, out);
    }
  return out;
}

const EXTERNAL = new Set([
  "vst3",
  "vst",
  "au",
  "audiounit",
  "lv2",
  "ladspa",
  "clap",
]);
const dumped = new Map<string, Set<string> | null>();

/** The names an external exposes, as the engine itself lists them — null when it cannot be built here. */
function externalParams(p: Plugin): Set<string> | null {
  const key = `${p.type}|${p.name}`.toLowerCase();
  if (dumped.has(key)) return dumped.get(key) ?? null;
  const scan = scannedPlugins().find(
    (s) => s.format.toLowerCase() === p.type.toLowerCase() && s.name === p.name,
  );
  let names: Set<string> | null = null;
  if (scan?.id) {
    try {
      // A state file that does not exist is warned about and skipped: the NAMES are what is asked.
      const out = execFileSync(
        engineBinary(),
        [
          "--dump-params-ext",
          scan.format,
          scan.id,
          join(HERE, "no-state.vstpreset"),
        ],
        {
          encoding: "utf8",
          maxBuffer: 64 << 20,
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 120_000,
        },
      );
      const body = out
        .split("STUDIO_PARAMS_BEGIN")[1]
        ?.split("STUDIO_PARAMS_END")[0];
      if (body) names = new Set(Object.keys(JSON.parse(body).params ?? {}));
    } catch {
      names = null;
    }
  }
  dumped.set(key, names);
  return names;
}

interface Finding {
  panel: string;
  plugin: string;
  missing?: string[];
  /** For a missing bind, the exposed name it matches but for case, spaces and punctuation — a typo, not a hole. */
  near?: Record<string, string>;
  skipped?: string;
}

// Case, spaces and punctuation dropped: what tells a misspelt bind from one the plugin does not have.
const loose = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const findings: Finding[] = [];
for (const [ref, folder] of [...folders].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const uiFile = join(folder, "ui.yaml");
  if (!existsSync(uiFile)) continue;
  if (only && !ref.toLowerCase().includes(only)) continue;
  const binds = bindsOf(readYaml(uiFile));
  if (!binds.size) continue;
  const plugin = pluginOf(folder);
  const label = plugin ? `${plugin.type} ${plugin.name}` : "—";
  if (!plugin) {
    findings.push({
      panel: ref,
      plugin: label,
      skipped: "no plugin resolved (jsdsp, faust, rack, or not scanned here)",
    });
    continue;
  }
  const type = plugin.type.toLowerCase();
  let has: Set<string> | null = null;
  if (type === "internal") {
    const info = builtinPluginFor(plugin);
    has = info ? new Set(info.params.map((p) => p.name)) : null;
  } else if (EXTERNAL.has(type)) {
    if (!asJson) process.stderr.write(`dumping ${plugin.name}…\n`);
    has = externalParams(plugin);
  } else {
    findings.push({
      panel: ref,
      plugin: label,
      skipped: `a ${type} plugin: its params are its source's`,
    });
    continue;
  }
  if (!has) {
    findings.push({
      panel: ref,
      plugin: label,
      skipped: "could not list its parameters here (not installed?)",
    });
    continue;
  }
  const missing = [...binds].filter((b) => !has.has(b)).sort();
  if (!missing.length) continue;
  const byLoose = new Map([...has].map((n) => [loose(n), n]));
  const near: Record<string, string> = {};
  for (const m of missing) {
    const hit = byLoose.get(loose(m));
    if (hit) near[m] = hit;
  }
  findings.push({ panel: ref, plugin: label, missing, near });
}

const broken = findings.filter((f) => f.missing);
if (asJson) console.log(JSON.stringify(findings, null, 2));
else {
  for (const f of broken)
    console.log(
      `${f.panel}  (${f.plugin})\n  ${f.missing
        ?.map((m) => (f.near?.[m] ? `${m}  — did you mean "${f.near[m]}"?` : m))
        .join("\n  ")}`,
    );
  const skipped = findings.filter((f) => f.skipped);
  if (skipped.length) {
    console.log(`\n${skipped.length} panel(s) not checked:`);
    for (const f of skipped)
      console.log(`  ${f.panel}  (${f.plugin}) — ${f.skipped}`);
  }
  console.log(
    `\n${broken.length} panel(s) bind a parameter their plugin does not expose, ${broken.reduce((n, f) => n + (f.missing?.length ?? 0), 0)} bind(s) in all.`,
  );
}
process.exit(broken.length ? 1 : 0);
