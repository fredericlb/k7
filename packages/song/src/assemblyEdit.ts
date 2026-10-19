// assemblyEdit.ts — making a box, and taking one apart. Instancing copies the template's node
// files into the project and its segments into `graph.k7x`, so what lands on disk is an ordinary
// graph plus one record saying which of its nodes are that box: nothing downstream learns a thing.
// The three writes that keep the record honest when a node is renamed or deleted are here too.
// Full rationale: docs/assemblies.md.

import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { K7Document } from "@studio/k7x/document";
import { splitPort } from "@studio/song-schema/moduleTypes";
import {
  formatAssembly,
  parseAssembly,
  renameAssemblyMember,
} from "@studio/song-schema/yaml/assemblyFile";
import { ASSEMBLIES_DIR } from "@studio/song-schema/yaml/assemblySchema";
import {
  mergeSegments,
  parseGraph,
  setNodePosition,
} from "@studio/song-schema/yaml/graphFile";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import {
  assembliesNaming,
  loadAssemblyTemplate,
  projectAssemblies,
} from "./assemblies";
import { isChainProject } from "./chainProject";
import { entityFiles } from "./yaml/moduleIO";
import { wsEdit, wsText, wsWriteText } from "./yaml/workspaceDoc";

/** The name a member takes in the project: the box's, then the template's own word for it. */
export const memberName = (assembly: string, member: string): string =>
  `${assembly}_${member}`;

const fileFor = (dir: string, id: string): string =>
  join(dir, ASSEMBLIES_DIR, `${id}.k7x`);

/** Instance a template into this project — its node files, its segments, and the record. */
export function createAssembly(
  dir: string,
  ref: string,
  id: string,
  at?: { x: number; y: number },
): { file: string; members: Record<string, string> } {
  // A box names its members by NAME, which a chain project's nodes no longer have (docs/chainFiles.md).
  if (isChainProject(dir))
    throw new Error(
      "a chain project cannot hold assemblies yet — a box names its nodes, and these are known by id",
    );
  // The filename IS the id, exactly as it is for a surface and every other flat entity folder.
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw new Error(
      `invalid assembly name '${id}' — letters, digits, '_' and '-' only`,
    );
  if (existsSync(fileFor(dir, id)))
    throw new Error(`assembly '${id}' already exists`);
  const loaded = loadAssemblyTemplate(dir, ref);
  if (!loaded)
    throw new Error(
      `no assembly template '${ref}' in the account's libraries (a library's ${ASSEMBLIES_DIR}/, named @<library>/<path>)`,
    );
  // A member is a node file the template carries: that is what makes it a use of a module.
  const files = entityFiles(join(loaded.folder, "nodes"), "nodes");
  if (!files.length)
    throw new Error(`assembly template '${ref}' holds no nodes/ to instance`);
  const members: Record<string, string> = {};
  for (const { id: member } of files) members[member] = memberName(id, member);

  const graphPath = join(dir, GRAPH_FILE);
  const graph = new K7Document(wsText(graphPath));
  const taken = new Set(
    Object.keys(parseGraph(graph.toString()).value?.modules ?? {}),
  );
  for (const [member, node] of Object.entries(members))
    if (taken.has(node))
      throw new Error(
        `'${node}' is already in the graph — rename the box, or the member '${member}'`,
      );

  // The template's segments renamed for this instance; a destination it does not own is kept, as where its signal leaves to.
  const local = (ref_: string): string => {
    const { node, port } = splitPort(ref_);
    const mapped = members[node];
    if (!mapped) return ref_;
    return port ? `${mapped}#${port}` : mapped;
  };
  const source = parseGraph(wsText(join(loaded.folder, GRAPH_FILE)));
  if (!source.value)
    throw new Error(
      `assembly template '${ref}': its ${GRAPH_FILE} will not read — ${source.issues[0]?.message ?? "unreadable"}`,
    );
  const modules: Record<string, string[]> = {};
  for (const [key, dests] of Object.entries(source.value.modules ?? {}))
    modules[local(key)] = dests.map(local);
  // A member the graph never names still gets an entry: every node is in the graph (docs/nodes.md).
  for (const node of Object.values(members)) modules[node] ??= [];

  mkdirSync(join(dir, "nodes"), { recursive: true });
  for (const { id: member, file } of files) {
    copyFileSync(file.path, join(dir, "nodes", `${members[member]}.k7x`));
    // Its opaque plugin state travels with it, or every instance would start from the plugin's default.
    const preset = join(loaded.folder, "nodes", `${member}.vstpreset`);
    if (existsSync(preset))
      copyFileSync(preset, join(dir, "nodes", `${members[member]}.vstpreset`));
  }
  mergeSegments(graph.at([]), {
    modules,
    bypassed: (source.value.bypassed ?? []).map(local),
    bus_only: (source.value.bus_only ?? []).map(local),
  });
  // The box's own pin, under the INSTANCE's name — one flat key space, so it needs no folder of its own.
  if (at) setNodePosition(graph.at([]), id, at);
  wsWriteText(graphPath, graph.toString());

  mkdirSync(join(dir, ASSEMBLIES_DIR), { recursive: true });
  wsWriteText(
    fileFor(dir, id),
    formatAssembly({ uses: ref, members }, [
      `${id} — one ${ref}. Its members are ordinary nodes; this file is what draws them as a box.`,
    ]),
  );
  return { file: `${ASSEMBLIES_DIR}/${id}.k7x`, members };
}

/** The members of a box, as node names — what `assembly delete` walks and `dissolve` leaves alone. */
export function assemblyMembers(dir: string, id: string): string[] {
  const found = projectAssemblies(dir).assemblies.find((a) => a.id === id);
  if (!found) throw new Error(`no assembly '${id}' in this project`);
  return Object.values(found.assembly.members);
}

/** Drop the RECORD and nothing else: the nodes stay exactly where they are, wired as they were. */
export function dissolveAssembly(dir: string, id: string): string {
  const path = fileFor(dir, id);
  if (!existsSync(path)) throw new Error(`no assembly '${id}' in this project`);
  rmSync(path);
  return `${ASSEMBLIES_DIR}/${id}.k7x`;
}

/** A node was RENAMED: every box holding it follows, since a member is a reference we can write back. */
export function renameNodeInAssemblies(
  dir: string,
  from: string,
  to: string,
): string[] {
  const touched: string[] = [];
  for (const a of assembliesNaming(dir, from)) {
    let renamed = false;
    wsEdit(join(dir, a.file), (doc) => {
      renamed = renameAssemblyMember(doc.at([]), from, to);
    });
    if (renamed) touched.push(a.id);
  }
  return touched;
}

/** …and a node DELETED: the member goes, and the box with it once it has no members left. */
export function dropNodeFromAssemblies(dir: string, node: string): string[] {
  const touched: string[] = [];
  for (const a of assembliesNaming(dir, node)) {
    const path = join(dir, a.file);
    const parsed = parseAssembly(wsText(path));
    if (!parsed.value) continue;
    const gone = Object.entries(parsed.value.members).filter(
      ([, n]) => n === node,
    );
    // A box about nothing is not a box: the last member out takes the record with it.
    if (gone.length === Object.keys(parsed.value.members).length) rmSync(path);
    else
      wsEdit(path, (doc) => {
        for (const [member] of gone) doc.deleteIn(["members", member]);
      });
    touched.push(a.id);
  }
  return touched;
}
