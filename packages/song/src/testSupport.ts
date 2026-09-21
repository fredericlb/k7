// testSupport.ts — fixture surgery for the tests, not used by the app: they copy a shipped demo and change one
// thing about it. YAML is a document, so these edit it as one — the value is found by PATH, not by matching
// source text, and a path that isn't there throws instead of quietly doing nothing.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  insertBetween,
  parseGraph,
  renameNode,
} from "@studio/song-schema/yaml/graphFile";
import { stringify } from "yaml";

/** The BENCH fixture, re-exported here rather than published as a subpath nobody outside imports. */
export {
  BENCH_SIZES,
  type BenchSize,
  benchProjectFiles,
  writeBenchProject,
} from "./benchProject";
// The app's own writer: a second implementation would be the thing under test.
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

/** Write a LANE: `writeNode` with the `extends` spelled, so a fixture says "a lane". */
export function writeLane(
  dir: string,
  name: string,
  extend: "track" | "strudel-track" | "group-track" = "track",
  value: Record<string, unknown> = {},
): string {
  return writeNode(dir, name, { extends: `@meta/${extend}`, ...value });
}

/** Write one USE of a module, flat at `nodes/<name>.yaml`; what it uses is `extends`, in `value`. */
export function writeNode(dir: string, name: string, value: unknown): string {
  const path = join(dir, "nodes", `${name}.yaml`);
  writeYaml(path, value);
  return path;
}

/** The first graph node starting with `prefix`, key or destination; throws so a moved step fails loudly. */
export function chainNodeNamed(dir: string, prefix: string): string {
  const { value } = parseGraph(readFileSync(join(dir, "graph.yaml"), "utf8"));
  for (const key of Object.keys(value?.modules ?? {}))
    if (key.startsWith(prefix)) return key;
  for (const dests of Object.values(value?.modules ?? {}))
    for (const d of dests) if (d.startsWith(prefix)) return d;
  throw new Error(`no chain node whose name starts with '${prefix}'`);
}

// Both edits go through the SHIPPING writers, or the tests end up measuring the helper.
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

/** A workspace's shared `_modules`, spelled out rather than built by a production writer. */
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

/** The account's LIBRARY submodule as a plain folder: the `@st0` level comes from `_libraries/modules`. */
export function writeLibraries(
  root: string,
  modules: Record<string, unknown> = {
    "audio/reverb": { plugin: { type: "vst3", name: "Big Reverb" } },
  },
): void {
  for (const [path, value] of Object.entries(modules))
    writeYaml(join(root, "_libraries", "modules", path, "module.yaml"), value);
}
