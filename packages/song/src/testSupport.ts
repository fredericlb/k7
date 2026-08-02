// testSupport.ts — fixture surgery for the tests, not used by the app: they copy a shipped demo and change one
// thing about it. YAML is a document, so these edit it as one — the value is found by PATH, not by matching
// source text, and a path that isn't there throws instead of quietly doing nothing.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseDocument, stringify } from "yaml";
import { insertBetween, parseChains, renameNode } from "./yaml/chainsFile";

/** Parse a YAML file into a Document. */
export const readDoc = (file: string) =>
  parseDocument(readFileSync(file, "utf8"), { version: "1.2" });

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
 * The first node in chains.yaml whose name starts with `prefix` — a `modules:` key, else a destination (which is
 * how a sink like OUT is named). Throws when there is none, so a fixture edit aimed at a step that has moved
 * fails loudly rather than passing silently.
 */
export function chainNodeNamed(dir: string, prefix: string): string {
  const { value } = parseChains(readFileSync(join(dir, "chains.yaml"), "utf8"));
  for (const key of Object.keys(value?.modules ?? {}))
    if (key.startsWith(prefix)) return key;
  for (const section of [value?.tracks, value?.modules])
    for (const dests of Object.values(section ?? {}))
      for (const d of dests) if (d.startsWith(prefix)) return d;
  throw new Error(`no chain node whose name starts with '${prefix}'`);
}

// Both edits go through the SHIPPING writers (chainsFile.ts): a fixture helper with its own idea of the format
// would drift from it, and then the tests would be measuring the helper.
const editChains = (dir: string, f: (text: string) => string): void => {
  const file = join(dir, "chains.yaml");
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
  const { value } = parseChains(readFileSync(join(dir, "chains.yaml"), "utf8"));
  const dests = value?.tracks?.[before] ?? value?.modules?.[before] ?? [];
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
  namespace = "engine",
  modules: Record<string, unknown> = {
    "audio/delay/tape-delay": { plugin: { type: "vst3", name: "Tape Delay" } },
    "instruments/4osc": { plugin: { type: "internal", name: "4OSC" } },
    "io/IN": { io: "in" },
    "io/OUT": { io: "out" },
  },
): void {
  const lib = join(root, "_modules");
  writeYaml(join(lib, "config.yaml"), { namespace });
  for (const [path, value] of Object.entries(modules))
    writeYaml(join(lib, path, "module.yaml"), value);
}
