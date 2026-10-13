// libraryChainsMigrate.ts — a library's FOLDER chains (`chains/<ref>/graph.yaml` + `nodes/`) rewritten
// as chain files `chains/<ref>.yaml`: each node inlined as an item with a fresh id, its comments kept,
// its preset moved to the library's `vstpresets/<id>.vstpreset`. docs/sharedFolders.md.
//
// What would be got wrong: a template is ONE run from `@in` to `@out`; anything else is refused by
// name, and every conversion is read back and compared with the folder before anything is written.

import { mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseChain } from "@studio/song-schema/yaml/chainFile";
import { VSTPRESETS_DIR } from "@studio/song-schema/yaml/chainSchema";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq } from "yaml";
import { newNodeId } from "./chainProject";
import { bypassedOf, CHAIN_IN, CHAIN_OUT } from "./chainsGraph";
import {
  type LibraryChainDir,
  readFileTemplate,
  readTemplate,
  TEMPLATE_OUT,
  type TemplateStep,
} from "./libraryChains";
import { wsExists, wsRead, wsWrite } from "./yaml/workspaceFile";

const OPTS = { version: "1.2" as const, strict: false };

/** One folder chain's conversion: where it goes, its text, and the presets that move with it. */
export interface ChainConversion {
  ref: string;
  from: string;
  to: string;
  text: string;
  /** Node name → its new id, in step order. */
  ids: [string, string][];
  presets: [string, string][];
  /** What the folder runs and what the file will — equal, or there is no conversion. */
  before: TemplateStep[];
  after: TemplateStep[];
  /** Said beside the result: why the folder reader disagreed with the run, when it did. */
  note?: string;
}

/** Every folder chain under `<libraryRoot>/chains`, by path — the old layout only. */
export function folderChains(
  library: string,
  libraryRoot: string,
): LibraryChainDir[] {
  const out: LibraryChainDir[] = [];
  const walk = (at: string, path: string): void => {
    const entries = readdirSync(at, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === GRAPH_FILE)) {
      out.push({
        ref: `@${library}/${path}`,
        library,
        path,
        at,
        layout: "folder",
        libraryRoot,
        nodes: [],
      });
      return;
    }
    for (const e of entries)
      if (e.isDirectory())
        walk(join(at, e.name), path ? `${path}/${e.name}` : e.name);
  };
  const root = join(libraryRoot, "chains");
  if (wsExists(root)) walk(root, "");
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** The node names of a graph that is ONE run `@in` → … → `@out`, or why it is not one. */
function runOf(graphText: string): string[] | string {
  const raw = (parseDocument(graphText, OPTS).toJS() ?? {}) as Record<
    string,
    unknown
  >;
  const edges: Record<string, string[]> = {};
  for (const key of ["tracks", "modules"]) {
    const m = raw[key];
    if (m && typeof m === "object") Object.assign(edges, m);
  }
  const run: string[] = [];
  for (let cur = CHAIN_IN; ; ) {
    const next = edges[cur];
    if (!Array.isArray(next) || next.length !== 1)
      return `"${cur}" does not lead to exactly one node`;
    if (next[0] === CHAIN_OUT) break;
    if (run.includes(next[0]) || next[0].includes("#"))
      return `"${next[0]}" is not one step of one run`;
    run.push(next[0]);
    cur = next[0];
  }
  const keys = Object.keys(edges).filter((k) => k !== CHAIN_IN);
  if (keys.length !== run.length || keys.some((k) => !run.includes(k)))
    return "it holds nodes off its run from @in to @out";
  return run;
}

/** The graph file's header, less any paragraph about the `@in`/`@out` ends the folder layout had. */
function headerOf(graphText: string): string | undefined {
  const doc = parseDocument(graphText, OPTS);
  // With no blank line under it, the header hangs on the first key rather than on the document.
  const first = isMap(doc.contents) ? doc.contents.items[0]?.key : null;
  const c =
    doc.commentBefore ??
    (isMap(doc.contents) ? doc.contents.commentBefore : null) ??
    (first && typeof first === "object" && "commentBefore" in first
      ? (first as { commentBefore?: string }).commentBefore
      : null);
  if (!c) return undefined;
  const kept = c
    .split(/\n[ \t]*\n/)
    .filter((p) => !p.includes("`@in`") && !/`modules:`/.test(p));
  return kept.length ? kept.join("\n \n") : undefined;
}

/** A node file as a chain item: `id` first, then its own fields as written, comments included. */
function itemOf(nodeText: string, id: string, bypass: boolean): YAMLMap {
  const doc = parseDocument(nodeText, OPTS);
  const item = new YAMLMap();
  item.items.push(doc.createPair("id", id));
  if (bypass) item.items.push(doc.createPair("bypass", true));
  if (isMap(doc.contents))
    item.items.push(...(doc.contents.items as typeof item.items));
  const before = [
    doc.commentBefore,
    isMap(doc.contents) ? doc.contents.commentBefore : null,
  ]
    .filter(Boolean)
    .join("\n");
  if (before) item.commentBefore = before;
  return item;
}

/** Steps reduced to what a reader RUNS — the module fields and the bypass, the name being the layout's. */
const runnable = (steps: TemplateStep[]) =>
  steps.map((s) => ({ module: s.module, bypass: !!s.bypass }));

/** The conversion of one folder chain, checked: throws with the reason when it cannot be carried over whole. */
export function convertFolderChain(c: LibraryChainDir): ChainConversion {
  const nodesDir = join(c.at, "nodes");
  const strays = readdirSync(c.at).filter(
    (f) => f !== GRAPH_FILE && f !== "nodes",
  );
  for (const f of wsExists(nodesDir) ? readdirSync(nodesDir) : [])
    if (!/\.(ya?ml|vstpreset)$/.test(f)) strays.push(`nodes/${f}`);
  if (strays.length)
    throw new Error(
      `holds ${strays.join(", ")}, which a chain file has no place for`,
    );
  const graphText = wsRead(join(c.at, GRAPH_FILE));
  const run = runOf(graphText);
  if (typeof run === "string") throw new Error(`not one run: ${run}`);
  // The run is the truth: a graph still keyed `tracks:` reads as NO step through the folder reader.
  const folder = readTemplate(c);
  const note = folder.steps.length
    ? undefined
    : "the folder reader reads none of it (its graph keeps the old `tracks:` key)";
  if (
    folder.steps.length &&
    !isDeepStrictEqual(
      folder.steps.map((s) => s.name),
      run,
    )
  )
    throw new Error("its run and the folder reader's steps disagree");
  const bypassed = bypassedOf(parseDocument(graphText, OPTS).toJS());
  const before: TemplateStep[] = [];
  for (const name of run) {
    const file = join(nodesDir, `${name}.yaml`);
    if (!wsExists(file))
      throw new Error(`names "${name}", and holds no nodes/${name}.yaml`);
    const preset = join(nodesDir, `${name}.vstpreset`);
    before.push({
      name,
      label: name,
      module: (parseDocument(wsRead(file), OPTS).toJS() ?? {}) as Record<
        string,
        unknown
      >,
      ...(bypassed.has(name) ? { bypass: true } : {}),
      ...(wsExists(preset) ? { preset } : {}),
    });
  }

  const doc = parseDocument("steps: []", OPTS);
  const steps = new YAMLSeq();
  const ids: [string, string][] = [];
  const presets: [string, string][] = [];
  for (const s of before) {
    const id = newNodeId();
    ids.push([s.name, id]);
    const nodeText = wsRead(join(nodesDir, `${s.name}.yaml`));
    steps.items.push(itemOf(nodeText, id, !!s.bypass));
    if (s.preset)
      presets.push([
        s.preset,
        join(c.libraryRoot, VSTPRESETS_DIR, `${id}.vstpreset`),
      ]);
  }
  const end = doc.createNode({ to: [{ chain: TEMPLATE_OUT }] }) as YAMLMap;
  const to = end.get("to", true);
  if (isSeq(to)) to.flow = true;
  steps.items.push(end);
  doc.set("steps", steps);
  const header = headerOf(graphText);
  if (header) doc.commentBefore = header;
  const text = doc.toString({ lineWidth: 0 });

  // Read back exactly as the reader will, and compared with the folder before a byte is written.
  const parsed = parseChain(text);
  if (!parsed.value)
    throw new Error(
      `converts to a file that does not read: ${parsed.issues.map((i) => i.message).join("; ")}`,
    );
  const to_ = `${c.at}.yaml`;
  const after = readFileTemplate({ ...c, at: to_, layout: "file" }, text).steps;
  if (!isDeepStrictEqual(runnable(after), runnable(before)))
    throw new Error("its chain file would not run the same steps");
  return {
    ref: c.ref,
    from: c.at,
    to: to_,
    text,
    ids,
    presets,
    before,
    after,
    note,
  };
}

/** Write a conversion: the file, its presets moved, the folder removed. */
export function applyConversion(cv: ChainConversion): void {
  wsWrite(cv.to, cv.text);
  for (const [from, to] of cv.presets) {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }
  rmSync(cv.from, { recursive: true, force: true });
}
