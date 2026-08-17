// testSupport.ts — fixture surgery for the tests, not used by the app: they copy a shipped demo and change one
// thing about it. YAML is a document, so these edit it as one — the value is found by PATH, not by matching
// source text, and a path that isn't there throws instead of quietly doing nothing.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import { insertBetween, parseGraph, renameNode } from "./yaml/graphFile";

/**
 * The BENCH fixture, re-exported here rather than published as a subpath of its own.
 *
 * Same audience as everything else in this file — code that only tests and benches run — and
 * `docs/inventaire.md` §1 counts 41 published subpaths nobody outside their package imports, so
 * the reflex to publish every file is one worth not indulging. `benchProject.ts` stays its own
 * file because building a song from nothing is not fixture surgery; this is only its door.
 */
export {
  BENCH_SIZES,
  type BenchSize,
  benchProjectFiles,
  writeBenchProject,
} from "./benchProject";
// The app's own writer — a test that used a second implementation would be testing that
// one, not the one shipping.
export {
  deleteFileValue as deleteYaml,
  setFileValue as setYaml,
} from "./yaml/edit";

/** Write `value` as a whole YAML file, making its folder. */
export function writeYaml(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    stringify(value, { version: "1.2", lineWidth: 0 }),
    "utf8",
  );
}

/** Write a module file: `modules/<type>/<name>/<file>.yaml` (default `module`). */
export function writeModule(
  dir: string,
  type: string,
  name: string,
  value: unknown,
  file = "module",
): string {
  const path = join(dir, "modules", type, name, `${file}.yaml`);
  writeYaml(path, value);
  return path;
}

/**
 * Write a LANE: a node extending one of the five built-in track modules.
 *
 * A thin wrapper over `writeNode`, because that is all a lane is now — but it spells the
 * `extends` so a fixture says "an audio lane" rather than repeating a ref. See
 * docs/trackModules.md.
 */
export function writeLane(
  dir: string,
  name: string,
  extend:
    | "audio-track"
    | "sequence-track"
    | "audio-strudel-track"
    | "sequence-strudel-track"
    | "group-track" = "audio-track",
  value: Record<string, unknown> = {},
): string {
  return writeNode(dir, name, { extends: `@studio/${extend}`, ...value });
}

/**
 * Write one USE of a module: `nodes/<name>.yaml`, flat, whatever it is a use of.
 *
 * The file names it — `name` is the key a chain writes — and it takes the same fields a
 * module file does. Which module it uses is `extends`, in `value`, and nothing else.
 */
export function writeNode(dir: string, name: string, value: unknown): string {
  const path = join(dir, "nodes", `${name}.yaml`);
  writeYaml(path, value);
  return path;
}

/**
 * The first node in graph.yaml whose name starts with `prefix` — a `modules:` key, else a destination (which is
 * how a sink like OUT is named). Throws when there is none, so a fixture edit aimed at a step that has moved
 * fails loudly rather than passing silently.
 */
export function chainNodeNamed(dir: string, prefix: string): string {
  const { value } = parseGraph(readFileSync(join(dir, "graph.yaml"), "utf8"));
  for (const key of Object.keys(value?.modules ?? {}))
    if (key.startsWith(prefix)) return key;
  for (const dests of Object.values(value?.modules ?? {}))
    for (const d of dests) if (d.startsWith(prefix)) return d;
  throw new Error(`no chain node whose name starts with '${prefix}'`);
}

// Both edits go through the SHIPPING writers (graphFile.ts): a fixture helper with its own idea of the format
// would drift from it, and then the tests would be measuring the helper.
const editChains = (dir: string, f: (text: string) => string): void => {
  const file = join(dir, "graph.yaml");
  writeFileSync(file, f(readFileSync(file, "utf8")), "utf8");
};

/** Rename that node to `step.module`, keeping its place and everything wired to it. */
export function replaceChainStep(
  dir: string,
  prefix: string,
  step: { module: string },
): void {
  const from = chainNodeNamed(dir, prefix);
  editChains(dir, (text) => renameNode(text, from, step.module).text);
}

/** Splice `step.module` in right after that node. */
export function insertChainStepAfter(
  dir: string,
  prefix: string,
  step: { module: string },
): void {
  const before = chainNodeNamed(dir, prefix);
  const { value } = parseGraph(readFileSync(join(dir, "graph.yaml"), "utf8"));
  const dests = value?.modules?.[before] ?? [];
  editChains(dir, (text) => insertBetween(text, before, dests[0], step.module));
}

/**
 * A workspace's shared `_modules`, written out for a test that needs one to inherit from.
 *
 * Three tests used to build this by calling `module populate`'s writer. That command is
 * gone — the engine answers what plugins exist now — and leaning on a production writer
 * to make a fixture hid what the fixture actually WAS behind a plugin list and a
 * category-mapping rule. Here the files are the point, so they are spelled out.
 */
export function writeLibrary(
  root: string,
  modules: Record<string, unknown> = {
    "audio/delay/tape-delay": { plugin: { type: "vst3", name: "Tape Delay" } },
    "instruments/4osc": { plugin: { type: "internal", name: "4OSC" } },
    "io/IN": { io: "in" },
    "io/OUT": { io: "out" },
  },
): void {
  // No config.yaml: `_modules` is `@workspace` because of WHERE it is, not because it says so.
  const lib = join(root, "_modules");
  for (const [path, value] of Object.entries(modules))
    writeYaml(join(lib, path, "module.yaml"), value);
}

/**
 * The account's LIBRARY submodule, written into a workspace — the `@st0` level.
 *
 * A plain folder here, where the real thing is a git checkout: nothing in `@studio/song` asks
 * whether it is one. The level comes from the folder it sits in (`_libraries/modules`), which
 * is exactly what these fixtures are pinning down.
 *
 * It used to be `$STUDIO_MEDIATEK/modules` — one per machine, and therefore an ambient input
 * every test in this package had to defend against. Beside the project it is just another
 * folder in the temp workspace, so there is no environment to set and nothing to restore.
 */
export function writeLibraries(
  root: string,
  modules: Record<string, unknown> = {
    "audio/reverb": { plugin: { type: "vst3", name: "Big Reverb" } },
  },
): void {
  for (const [path, value] of Object.entries(modules))
    writeYaml(join(root, "_libraries", "modules", path, "module.yaml"), value);
}
