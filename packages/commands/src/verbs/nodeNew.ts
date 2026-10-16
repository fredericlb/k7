// nodeNew.ts — making nodes and modules: `node new`, `node insert` on an arrow, and the
// module verbs (create, own, fork, clone). See docs/verbs.md.

import { join, resolve } from "node:path";
import { forkIntoAccount } from "@studio/song/accountFork";
import { chainNodeName } from "@studio/song/chainGraphEdit";
import {
  coldPlacementError,
  loadGraph,
  nodeCaption,
  nodePlaces,
} from "@studio/song/graph";
import {
  cloneModuleFile,
  createModuleFile,
  createNode,
  freeNodeName,
  loadChains,
  loadProjectRoot,
} from "@studio/song/loader";
import { materialiseEngineModule } from "@studio/song/moduleFork";
import { createNodeOn } from "@studio/song/nodeOnRef";
import { SHARED_MODULES_PATH } from "@studio/song/sharedFolders";
import {
  isProjectFolder,
  moduleFileFor,
  readModuleFile,
} from "@studio/song/yaml/moduleIO";
import { wsExists } from "@studio/song/yaml/workspaceFile";
import {
  connectChainNodes,
  insertChainStep,
  placeChainNode,
  setChainNodePosition,
} from "@studio/song-edit/projectEdit";
import {
  MIX_NODE,
  OUT_NODE,
  RENDER_NODE,
  VIDEO_OUT_NODE,
} from "@studio/song-schema/moduleTypes";
import type { GraphFile } from "@studio/song-schema/yaml/graphSchema";
import type { SidHandler } from "../commands.ts";
import { splitWords, takeSpawnAt } from "./shared.ts";

const isMasterRun = (before: string, after: string): boolean =>
  (before === MIX_NODE && after === OUT_NODE) ||
  (before === RENDER_NODE && after === VIDEO_OUT_NODE);

/** How `before → after` stands in graph.yaml: an arrow, a line to WRITE first, or why it is neither. */
function arrowState(
  songPath: string,
  before: string,
  after: string,
): { ok: true; write: boolean } | { ok: false; error: string } {
  // Read off the SEGMENTS, not the chains — those are derived by following exactly these arrows.
  const file = loadChains(songPath, loadProjectRoot(songPath, true), true) as
    | GraphFile
    | undefined;
  const dests = file?.modules?.[before];
  // A sum feeding nothing yet: the wire to its device is on screen, so it is a wire to splice into.
  if (!dests?.length && isMasterRun(before, after))
    return { ok: true, write: true };
  if (!dests)
    return {
      ok: false,
      error: `no node "${before}" in graph.yaml (nodes: ${
        Object.keys(file?.modules ?? {}).join(", ") || "none"
      })`,
    };
  if (!dests.includes(after))
    return {
      ok: false,
      error: `'${before}' does not feed '${after}' (it feeds: ${dests.join(", ") || "nothing"})`,
    };
  return { ok: true, write: false };
}

/** Where a node WIRED TO NOTHING is born when no cursor said: above the origin, clear of the first lane; docs/verbs.md. */
const ORPHAN_AT = { x: 0, y: -30 };

/** …and where a SPLICED one is: halfway between the two ends, which is where its cable ran; null when either is unpinned. */
function midOfArrow(
  positions: Record<string, { x: number; y: number }> | undefined,
  before: string,
  after: string,
): { x: number; y: number } | null {
  const a = positions?.[before.split("#")[0]];
  const b = positions?.[after.split("#")[0]];
  if (!a || !b) return null;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Where a `module new`/`node new` target's OWN files would live — the workspace for a real
 *  project, or the folder itself for a template being edited with `at` (no project.yaml). */
function localModuleFolder(
  songPath: string,
  category: string,
  name: string,
): string {
  return isProjectFolder(songPath)
    ? resolve(songPath, SHARED_MODULES_PATH, category, name)
    : join(songPath, "modules", category, name);
}

/** What a module already on disk extends, or "" — read from its own file, not through the loaders. */
function existingExtends(
  songPath: string,
  category: string,
  name: string,
): string {
  const folder = localModuleFolder(songPath, category, name);
  const file = moduleFileFor(folder, `${category}/${name}`, "module");
  if (!file) return "";
  try {
    const ext = readModuleFile(file).value?.extends;
    return typeof ext === "string" ? ext : "";
  } catch {
    return ""; // unreadable: the caller's other checks still apply, and instancing is harmless
  }
}

/** Create the module `module new` names and hand back its name, or the message to show instead — docs/verbs.md. */
function makeModule(
  songPath: string,
  target: string,
  extendsRef?: string,
): { ref: string; rel: string | null } | { error: string } {
  const segs = target.split("/");
  if (segs.length !== 2 || !segs[0] || !segs[1])
    return { error: `'${target}' is not <category>/<name>` };
  const [category, name] = segs;
  const exists = wsExists(localModuleFolder(songPath, category, name));
  // The picker names a local module by its OWN ref: that is "use it", not "make it inherit itself".
  const own = `${isProjectFolder(songPath) ? "@workspace" : "@project"}/${category}/${name}`;
  if (exists && extendsRef === own) return { ref: name, rel: null };
  // Already there AND told to inherit something else is a real disagreement: a module cannot be re-parented.
  if (exists && extendsRef) {
    const inherits = existingExtends(songPath, category, name);
    if (inherits && inherits !== extendsRef)
      return {
        error: `module '${name}' extends '${inherits}', not '${extendsRef}' — drop the extends-ref to use it as it is`,
      };
  }
  try {
    const rel = exists
      ? null
      : createModuleFile(songPath, category, name, extendsRef);
    return { ref: name, rel };
  } catch (e) {
    return { error: `${(e as Error).message} — nothing was changed` };
  }
}

/** A created node as a person reads it: its module and place in a chain project, its path otherwise. */
function shownNode(dir: string, rel: string): string {
  const p = nodePlaces(dir)[rel];
  return p ? `${nodeCaption(p)} (${rel})` : rel;
}

export const NODE_NEW_VERBS: Record<string, SidHandler> = {
  // One-shot format repairs are scripts under packages/song/scripts/, not rows in every palette.

  /** module new <category>/<name> [extends-ref] — scaffold a module, and only that; docs/verbs.md. */
  "module.create": async (a, h) => {
    const usage = "usage: module new <category>/<name> [extends-ref]";
    const [target, extendsRef, ...extra] = splitWords(a);
    if (!target || extra.length) {
      h.refuse([usage]);
      return;
    }
    const made = makeModule(h.songPath, target, extendsRef);
    if ("error" in made) {
      h.refuse([`module new failed: ${made.error}`, usage]);
      return;
    }
    const { rel } = made;
    // A chain names a NODE, never this — say so, since the next act is always the same one.
    const next = `use it with \`node new ${target} <node-name>\``;
    if (!rel) return h.refuse([`${target} is already here`, next]);
    h.log([
      `created ${rel} — add an inline plugin/rack (or an \`extends\`) to give it a sound`,
      next,
    ]);
    await h.reload();
  },
  /** node new <category>/<name>|<@ref> [<node-name>] [<extends-ref>] [x,y] — one USE of a module, AND its place in the graph; docs/verbs.md. */
  "node.new": async (a, h) => {
    const usage =
      "usage: node new <category>/<name>|<@module-ref> [<node-name>] [<extends-ref>] [x,y]";
    const parts = splitWords(a);
    // Born where the cursor was — the web sends the click, so a new node never asks the layout.
    const at = takeSpawnAt(parts);
    if (parts.length < 1 || parts.length > 3) {
      h.refuse([usage]);
      return;
    }
    const [target, ...rest] = parts;
    // A whole ref: the node extends it as it stands, with no workspace module scaffolded over it.
    if (target.startsWith("@")) {
      if (rest.length > 1 || rest.some((p) => p.includes("/"))) {
        h.refuse([usage]);
        return;
      }
      const leaf = target.split("/").pop() ?? "";
      const node = rest[0] ?? freeNodeName(h.songPath, leaf);
      try {
        const rel = createNodeOn(h.songPath, target, node);
        placeChainNode(h.songPath, node);
        setChainNodePosition(h.songPath, node, at ?? ORPHAN_AT);
        h.log([
          `created ${shownNode(h.songPath, rel)} on ${target} — in the graph, wired to nothing yet`,
        ]);
        await h.reload();
      } catch (e) {
        h.refuse([`node new failed: ${(e as Error).message}`]);
      }
      return;
    }
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.refuse([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, module] = segs;
    // Refs carry a slash, node names never do ([A-Za-z0-9_-]+): that is the whole distinction,
    // and it makes the ref's POSITION free — `… @engine/… name` and `… name @engine/…` both parse.
    const ref = rest.find((p) => p.includes("/"));
    const named = rest.find((p) => !p.includes("/"));
    if (rest.length > (ref && named ? 2 : 1)) {
      h.refuse([usage]);
      return;
    }
    // Nobody said what to call it: `<module>_<n>`, and no lane prefix — docs/verbs.md.
    const node = named ?? freeNodeName(h.songPath, module);
    try {
      // A CATALOGUE pick's node extends the ref itself: no workspace module is scaffolded in between (docs/verbs.md).
      const rel = ref
        ? createNodeOn(h.songPath, ref, node)
        : createNode(h.songPath, category, module, node);
      placeChainNode(h.songPath, node);
      // No cursor behind the line: a fresh layout would drop something wired to nothing anywhere, so this verb answers instead.
      setChainNodePosition(h.songPath, node, at ?? ORPHAN_AT);
      h.log([
        ref
          ? `created ${shownNode(h.songPath, rel)} on ${ref} — in the graph, wired to nothing yet`
          : `created ${shownNode(h.songPath, rel)} — in the graph, wired to nothing yet`,
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`node new failed: ${(e as Error).message}`]);
    }
  },
  // module own <ref> — give an engine module a folder here, and repoint the chains at it (see moduleFork.ts).
  "module.own": async (a, h) => {
    const ref = splitWords(a)[0];
    if (!ref) {
      h.refuse(["usage: module own <@engine/…>"]);
      return;
    }
    try {
      const r = materialiseEngineModule(h.songPath, ref);
      h.log([
        `${r.ref} is now ${r.path}` +
          (r.chains.length ? `, played by ${r.chains.join(", ")}` : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`module own failed: ${(e as Error).message}`]);
    }
  },
  /** module fork <@library/path> — the library module made the account's own, the project pointed at it. */
  "module.fork": async (a, h) => {
    const ref = splitWords(a)[0];
    if (!ref) return h.refuse(["usage: module fork <@library/path>"]);
    try {
      const r = forkIntoAccount(h.songPath, ref);
      h.log([
        `${r.ref} ${r.created ? "made, extending" : "already forks"} ${ref}` +
          (r.repointed.length
            ? ` — ${r.repointed.length} file${r.repointed.length > 1 ? "s" : ""} of this project now name it`
            : ""),
      ]);
      await h.reload();
    } catch (e) {
      h.refuse([`module fork: ${(e as Error).message}`]);
    }
  },
  "module.clone": async (a, h) => {
    const usage = "usage: clone module <category>/<name> <newName>";
    const args = a.trim().split(/\s+/);
    if (args.length !== 2 || !args[0] || !args[1]) {
      h.refuse([usage]);
      return;
    }
    const [target, newName] = args;
    const segs = target.split("/");
    if (segs.length !== 2 || !segs[0] || !segs[1]) {
      h.refuse([`'${target}' is not <category>/<name>`, usage]);
      return;
    }
    const [category, name] = segs;
    try {
      const rel = cloneModuleFile(h.songPath, category, name, newName);
      h.log([`cloned ${target} → ${rel}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`clone module failed: ${(e as Error).message}`]);
    }
  },
  // The graph and timeline describers have CLI entries of their own, not palette rows — commands.yaml.

  /** node insert <before> <after> <node> [x,y] — splice a node that EXISTS into an arrow; docs/verbs.md. */
  "node.insert": async (a, h) => {
    const usage =
      "usage: node insert <before> <after> <node> [x,y] (the two ends of one graph arrow, then the node to splice between them)";
    const parts = splitWords(a);
    const at = takeSpawnAt(parts);
    if (parts.length < 3) {
      h.refuse([usage]);
      return;
    }
    // A chain project's node answers to the name `node new` was given as well as to its id.
    const [before, after, node] = parts.map((p) =>
      chainNodeName(h.songPath, p),
    );
    let g: ReturnType<typeof loadGraph>;
    try {
      g = loadGraph(h.songPath);
    } catch (e) {
      h.refuse([`node insert: ${(e as Error).message}`]);
      return;
    }
    const arrow = arrowState(h.songPath, before, after);
    if (!arrow.ok) {
      h.refuse([arrow.error]);
      return;
    }
    // A real node: a shared module is named by its ref and lives in moduleRefs until a chain uses it.
    if (!(node in g.modules) && !(node in g.moduleRefs)) {
      h.refuse([
        `no node "${node}" in this project (nodes: ${Object.keys(g.modules).join(", ") || "none"}) — create one with \`node new\``,
      ]);
      return;
    }
    const cold = coldPlacementError(
      g,
      g.modules[node] ?? g.moduleRefs[node],
      node,
      before,
    );
    if (cold) {
      h.refuse([cold]);
      return;
    }
    try {
      // The master run drawn but never written: state the line, then splice into it — one command, as the `+` promises.
      if (arrow.write) connectChainNodes(h.songPath, before, after);
      insertChainStep(h.songPath, before, after, node);
      // Born where the `+` was clicked; from a typed line, on the cable it was spliced into — the same place, said twice.
      const born = at ?? midOfArrow(g.positions, before, after);
      if (born) setChainNodePosition(h.songPath, node, born);
      h.log([`inserted ${node} between ${before} and ${after}`]);
      await h.reload();
    } catch (e) {
      h.refuse([`node insert failed: ${(e as Error).message}`]);
    }
  },
};
