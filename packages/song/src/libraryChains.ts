// libraryChains.ts — the chains the account's libraries hold, walked once for every caller that
// asks (the chains builder, the account's listing, a bounce, the bench), and each one READ into
// the ordered steps those callers run. See docs/sharedFolders.md and docs/chainFiles.md.
//
// What a reader would get wrong: a chain is a FILE `<ref>.k7x` under a library's `chains/`, or an
// older FOLDER holding a `graph.k7x` and a `nodes/`; both are read (docs/sharedFolders.md).
// Its ref is `@<library>/<path under chains/>`, and a BARE path
// is the default library's.

import { type Dirent, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { stripDocExt } from "@studio/song-schema/docExt";
import {
  DEFAULT_LIBRARY,
  libraryRef,
  libraryRefParts,
} from "@studio/song-schema/moduleTypes";
import { moduleOfItem, parseChain } from "@studio/song-schema/yaml/chainFile";
import {
  isEndStep,
  type NodeItem,
  VSTPRESETS_DIR,
} from "@studio/song-schema/yaml/chainSchema";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { plainSegments } from "@studio/web-protocol/paths";
import { bypassedOf, chainSteps } from "./chainsGraph";
import { libraryFamilyRoots } from "./sharedFolders";
import { wsData, wsText } from "./yaml/workspaceDoc";
import { isDocName, K7X_EXT, wsExists } from "./yaml/workspaceFile";

/** Where a template's signal leaves, written as its last step's one link. */
export const TEMPLATE_OUT = "@out";
/** A FOLDER chain's node files, beside its graph file. */
const NODES_DIR = "nodes";

/** How a chain is kept on disk: one file (the format), or the folder an unmigrated clone still holds. */
export type ChainLayout = "file" | "folder";

/** One chain of a library: its ref (`@k7-core/bass/di`), which library and path that is, and where it is. */
export interface LibraryChainDir {
  ref: string;
  library: string;
  path: string;
  /** The chain's file, or its folder for the folder layout. */
  at: string;
  layout: ChainLayout;
  /** The library's own folder — where a file chain's node presets live, in `vstpresets/`. */
  libraryRoot: string;
  /** A folder chain's node files by name; a file chain holds its nodes, so none. */
  nodes: string[];
}

/** A folder chain's node files by NAME; a chain with no `nodes/` yet is a real state, so never a throw. */
function nodesIn(at: string): string[] {
  try {
    return readdirSync(join(at, NODES_DIR), { withFileTypes: true })
      .filter((e) => e.isFile() && isDocName(e.name))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Every chain under ONE `chains/` folder, by path. An unreadable folder answers nothing rather than throwing. */
function walkChains(library: string, chainsRoot: string): LibraryChainDir[] {
  const out: LibraryChainDir[] = [];
  const libraryRoot = dirname(chainsRoot);
  const walk = (at: string, path: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    // A graph file makes a FOLDER a chain, so the walk stops there and never reads its nodes as chains.
    if (entries.some((e) => e.isFile() && e.name === GRAPH_FILE)) {
      if (path)
        out.push({
          ref: libraryRef(library, path),
          library,
          path,
          at,
          layout: "folder",
          libraryRoot,
          nodes: nodesIn(at),
        });
      return;
    }
    for (const e of entries) {
      const sub = (name: string) => (path ? `${path}/${name}` : name);
      if (e.isDirectory()) walk(join(at, e.name), sub(e.name));
      else if (e.isFile() && isDocName(e.name)) {
        const p = sub(stripDocExt(e.name));
        out.push({
          ref: libraryRef(library, p),
          library,
          path: p,
          at: join(at, e.name),
          layout: "file",
          libraryRoot,
          nodes: [],
        });
      }
    }
  };
  walk(chainsRoot, "");
  return out;
}

/** Every chain of every library at the versions `from`'s workspace pins, by ref; a ref held both ways is its FILE. */
export function libraryChainDirs(from?: string): LibraryChainDir[] {
  const byRef = new Map<string, LibraryChainDir>();
  for (const l of libraryFamilyRoots("chains", from))
    for (const c of walkChains(l.name, l.root)) {
      const had = byRef.get(c.ref);
      if (!had || c.layout === "file") byRef.set(c.ref, c);
    }
  return [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref));
}

/** `@<library>/<path>`, or a bare `<path>` in the default library, split — null when it names no chain at all. */
export function chainRefParts(
  ref: string,
): { library: string; path: string } | null {
  const trimmed = ref.trim().replace(/\/+$/, "");
  const parts = libraryRefParts(trimmed);
  const library = parts ? parts.library : DEFAULT_LIBRARY;
  const path = (parts ? parts.rest : trimmed).replace(/^\/+/, "");
  if (trimmed.startsWith("@") && !parts) return null; // `@engine/…`, `@workspace/…`: no library
  // A ref is a path under the family folder, so a `..` in it would reach out of the library.
  if (!plainSegments(path)) return null;
  return { library, path };
}

/** The chain `ref` names, bare or with its library, or undefined. */
export function findLibraryChain(
  ref: string,
  from?: string,
): LibraryChainDir | undefined {
  const want = chainRefParts(ref);
  if (!want) return undefined;
  return libraryChainDirs(from).find(
    (c) => c.library === want.library && c.path === want.path,
  );
}

/** One step of a template, as every reader runs it — a name for messages and what a node file would hold. */
export interface TemplateStep {
  /** The node's name in a folder chain, its `id` in a file chain. */
  name: string;
  /** What a message calls it: its name, or a file chain's node by the module it extends. */
  label: string;
  /** The module fields alone — `extends`, `engine`, `params`… — ready for resolveModule. */
  module: Record<string, unknown>;
  bypass?: boolean;
  /** Its plugin state on disk, when it has one. */
  preset?: string;
}

/** What a template reads as: its steps in signal order, and the steps it names but does not hold. */
export interface TemplateRead {
  steps: TemplateStep[];
  missing: string[];
}

/** A template's steps in order; throws when its file does not read or is not a template's shape (docs/sharedFolders.md). */
export function readTemplate(c: LibraryChainDir): TemplateRead {
  return c.layout === "file" ? readFileTemplate(c) : readFolderTemplate(c);
}

function readFolderTemplate(c: LibraryChainDir): TemplateRead {
  const graph = join(c.at, GRAPH_FILE);
  const text = wsText(graph);
  const bypassed = bypassedOf(wsData(graph));
  const steps: TemplateStep[] = [];
  const missing: string[] = [];
  for (const name of chainSteps(text)) {
    let module: Record<string, unknown>;
    try {
      module = wsData(join(c.at, NODES_DIR, `${name}${K7X_EXT}`));
    } catch {
      missing.push(`${name} (no ${NODES_DIR}/${name}${K7X_EXT})`);
      continue;
    }
    const preset = join(c.at, NODES_DIR, `${name}.vstpreset`);
    steps.push({
      name,
      label: name,
      module,
      ...(bypassed.has(name) ? { bypass: true } : {}),
      ...(wsExists(preset) ? { preset } : {}),
    });
  }
  return { steps, missing };
}

/** A chain file's steps from its TEXT — `text` given when it is not on disk yet, as a migration checks it. */
export function readFileTemplate(
  c: LibraryChainDir,
  text = wsText(c.at),
): TemplateRead {
  const { value, issues } = parseChain(text);
  if (!value)
    throw new Error(
      issues
        .map(
          (i) =>
            `${i.line ? `${i.line}:${i.col} ` : ""}${i.path ? `${i.path}: ` : ""}${i.message}`,
        )
        .join("; "),
    );
  // A template is fed by whatever it is put after, so it neither starts nor names ports — docs/sharedFolders.md.
  if (value.start !== undefined || value.ports?.length)
    throw new Error(
      "a template has no `start` and no `ports`: its one input is what it is put after",
    );
  // A template is ONE run spliced where it is put, and a subchain is a branch it would carry in with it.
  if (value.subchains?.length)
    throw new Error("a template is one run: it holds no `subchains`");
  const steps: TemplateStep[] = [];
  for (const [i, s] of value.steps.entries()) {
    if (isEndStep(s)) {
      const strays = s.to.filter((l) => l.chain !== TEMPLATE_OUT);
      if (strays.length)
        throw new Error(
          `a template links only to "${TEMPLATE_OUT}", not ${strays.map((l) => `"${l.chain}"`).join(", ")}`,
        );
      continue;
    }
    if (Array.isArray(s))
      throw new Error(
        `step ${i + 1} is side by side — a template is one run, step after step`,
      );
    const item = s as NodeItem;
    const preset = join(
      c.libraryRoot,
      VSTPRESETS_DIR,
      item.vstpreset ?? `${item.id}.vstpreset`,
    );
    const module = moduleOfItem(item);
    steps.push({
      name: item.id,
      label: typeof module.extends === "string" ? module.extends : item.id,
      module,
      ...(item.bypass ? { bypass: true } : {}),
      ...(wsExists(preset) ? { preset } : {}),
    });
  }
  return { steps, missing: [] };
}
