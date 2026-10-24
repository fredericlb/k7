// testSupport.ts — fixture surgery for the tests, not used by the app: they copy a shipped demo and change one
// thing about it. A k7x file is a document, so these edit it as one — the value is found by PATH, not by matching
// source text, and a path that isn't there throws instead of quietly doing nothing.

import { cpSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { K7Document } from "@studio/k7x/document";
import {
  insertBetween,
  parseGraph,
  renameNode,
} from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { wsText, wsWriteData, wsWriteText } from "./yaml/workspaceDoc";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A repository fixture as it was BEFORE its picture lanes were nodes — `fixtures/pictureLanesV2`, its media borrowed from the fixture today. */
export function copyOldPictureFixture(rel: string, to: string): void {
  const name = basename(rel);
  cpSync(
    join(REPO, "packages", "song", "fixtures", "pictureLanesV2", name),
    to,
    {
      recursive: true,
    },
  );
  const clips = join(REPO, rel, "clips");
  for (const f of readdirSync(clips))
    if (!f.endsWith(".k7x")) cpSync(join(clips, f), join(to, "clips", f));
}

/** The BENCH fixture, re-exported here rather than published as a subpath nobody outside imports. */
export {
  BENCH_SIZES,
  type BenchSize,
  benchProjectFiles,
  writeBenchProject,
} from "./benchProject";
// The app's own writer: a second implementation would be the thing under test.
export {
  deleteFileValue as deleteDoc,
  setFileValue as setDoc,
} from "./yaml/edit";

/** Write `value` as a whole .k7x file, making its folder; a non-.k7x path or a non-map value throws. */
export function writeDoc(file: string, value: unknown): void {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${file}: a k7x file holds a map`);
  mkdirSync(dirname(file), { recursive: true });
  wsWriteData(file, value as Record<string, unknown>);
}

/** Write a module file: `modules/<type>/<name>/<file>.k7x` (default `module`). */
export function writeModule(
  dir: string,
  type: string,
  name: string,
  value: unknown,
  file = "module",
): string {
  const path = join(dir, "modules", type, name, `${file}.k7x`);
  writeDoc(path, value);
  return path;
}

/** Write a LANE: `writeNode` with the `extends` spelled, so a fixture says "a lane". */
export function writeLane(
  dir: string,
  name: string,
  extend: "track" | "strudel-track" | "group-track" | "picture-track" = "track",
  value: Record<string, unknown> = {},
): string {
  return writeNode(dir, name, { extends: `@meta/${extend}`, ...value });
}

/** Write one USE of a module, flat at `nodes/<name>.k7x`; what it uses is `extends`, in `value`. */
export function writeNode(dir: string, name: string, value: unknown): string {
  const path = join(dir, "nodes", `${name}.k7x`);
  writeDoc(path, value);
  return path;
}

/** The first graph node starting with `prefix`, key or destination; throws so a moved step fails loudly. */
export function chainNodeNamed(dir: string, prefix: string): string {
  const { value } = parseGraph(wsText(join(dir, GRAPH_FILE)));
  for (const key of Object.keys(value?.modules ?? {}))
    if (key.startsWith(prefix)) return key;
  for (const dests of Object.values(value?.modules ?? {}))
    for (const d of dests) if (d.startsWith(prefix)) return d;
  throw new Error(`no chain node whose name starts with '${prefix}'`);
}

// Both edits go through the SHIPPING writers on the raw document, which keep a `runs(...)` form themselves.
const editChains = (dir: string, f: (doc: K7Document) => void): void => {
  const file = join(dir, GRAPH_FILE);
  const doc = new K7Document(wsText(file));
  f(doc);
  wsWriteText(file, doc.toString());
};

/** Rename that node to `step.module`, keeping its place and everything wired to it. */
export function replaceChainStep(
  dir: string,
  prefix: string,
  step: { module: string },
): void {
  const from = chainNodeNamed(dir, prefix);
  editChains(dir, (doc) => {
    renameNode(doc.at([]), from, step.module);
  });
}

/** Splice `step.module` in right after that node. */
export function insertChainStepAfter(
  dir: string,
  prefix: string,
  step: { module: string },
): void {
  const before = chainNodeNamed(dir, prefix);
  const { value } = parseGraph(wsText(join(dir, GRAPH_FILE)));
  const dests = value?.modules?.[before] ?? [];
  editChains(dir, (doc) =>
    insertBetween(doc.at([]), before, dests[0], step.module),
  );
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
  // No config.k7x: `_modules` is `@workspace` because of WHERE it is, not because it says so.
  const lib = join(root, "_modules");
  for (const [path, value] of Object.entries(modules))
    writeDoc(join(lib, path, "module.k7x"), value);
}

/** Library `name`'s folder, `<root>/.studio-home/libraries/<name>`, with `$STUDIO_HOME` pointed inside the test's own folder. */
export function librariesFixture(root: string, name = "k7-core"): string {
  const home = join(root, ".studio-home");
  process.env.STUDIO_HOME = home;
  const lib = join(home, "libraries", name);
  mkdirSync(lib, { recursive: true });
  return lib;
}

/** One of the account's LIBRARIES as a plain folder: the `@<name>` level comes from its `modules/`. */
export function writeLibraries(
  root: string,
  modules: Record<string, unknown> = {
    "audio/reverb": { plugin: { type: "vst3", name: "Big Reverb" } },
  },
  name = "k7-core",
): string {
  const lib = librariesFixture(root, name);
  for (const [path, value] of Object.entries(modules))
    writeDoc(join(lib, "modules", path, "module.k7x"), value);
  return lib;
}
