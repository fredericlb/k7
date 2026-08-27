// assemblyEdit.ts — making a box, and taking one apart. Instancing copies the template's node
// files into the project and its segments into `graph.yaml`, so what lands on disk is an ordinary
// graph plus one record saying which of its nodes are that box: nothing downstream learns a thing.
// The three writes that keep the record honest when a node is renamed or deleted are here too.
// Full rationale: docs/assemblies.md.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
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
import { entityFiles } from "./yaml/moduleIO";

/** The name a member takes in the project: the box's, then the template's own word for it. */
export const memberName = (assembly: string, member: string): string =>
  `${assembly}_${member}`;

const fileFor = (dir: string, id: string): string =>
  join(dir, ASSEMBLIES_DIR, `${id}.yaml`);

/** Instance a template into this project — its node files, its segments, and the record. */
export function createAssembly(
  dir: string,
  ref: string,
  id: string,
  at?: { x: number; y: number },
): { file: string; members: Record<string, string> } {
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
      `no assembly template '${ref}' in this workspace's library (_libraries/${ASSEMBLIES_DIR}/)`,
    );
  // A member is a node file the template carries: that is what makes it a use of a module.
  const files = entityFiles(join(loaded.folder, "nodes"), "nodes");
  if (!files.length)
    throw new Error(`assembly template '${ref}' holds no nodes/ to instance`);
  const members: Record<string, string> = {};
  for (const { id: member } of files) members[member] = memberName(id, member);

  const graphPath = join(dir, GRAPH_FILE);
  const graphText = readFileSync(graphPath, "utf8");
  const taken = new Set(
    Object.keys(parseGraph(graphText).value?.modules ?? {}),
  );
  for (const [member, node] of Object.entries(members))
    if (taken.has(node))
      throw new Error(
        `'${node}' is already in the graph — rename the box, or the member '${member}'`,
      );

  // The template's segments, every name inside it swapped for this instance's. A destination the
  // template does not own is copied verbatim: that is how a template says where its signal leaves to.
  const local = (ref_: string): string => {
    const { node, port } = splitPort(ref_);
    const mapped = members[node];
    if (!mapped) return ref_;
    return port ? `${mapped}#${port}` : mapped;
  };
  const source = parseGraph(
    readFileSync(join(loaded.folder, GRAPH_FILE), "utf8"),
  );
  if (!source.value)
    throw new Error(
      `assembly template '${ref}': its graph.yaml will not read — ${source.issues[0]?.message ?? "unreadable"}`,
    );
  const modules: Record<string, string[]> = {};
  for (const [key, dests] of Object.entries(source.value.modules ?? {}))
    modules[local(key)] = dests.map(local);
  // A member the graph never names still gets an entry: every node is in the graph (docs/nodes.md).
  for (const node of Object.values(members)) modules[node] ??= [];

  mkdirSync(join(dir, "nodes"), { recursive: true });
  for (const { id: member, file } of files) {
    copyFileSync(file.path, join(dir, "nodes", `${members[member]}.yaml`));
    // Its opaque plugin state travels with it, or every instance would start from the plugin's default.
    const preset = join(loaded.folder, "nodes", `${member}.vstpreset`);
    if (existsSync(preset))
      copyFileSync(preset, join(dir, "nodes", `${members[member]}.vstpreset`));
  }
  let next = mergeSegments(graphText, {
    modules,
    bypassed: (source.value.bypassed ?? []).map(local),
    bus_only: (source.value.bus_only ?? []).map(local),
  });
  // The box's own pin, under the INSTANCE's name — one flat key space, so it needs no folder of its own.
  if (at) next = setNodePosition(next, id, at);
  writeFileSync(graphPath, next, "utf8");

  mkdirSync(join(dir, ASSEMBLIES_DIR), { recursive: true });
  writeFileSync(
    fileFor(dir, id),
    formatAssembly(
      { uses: ref, members },
      `# ${id} — one ${ref}. Its members are ordinary nodes; this file is what draws them as a box.`,
    ),
    "utf8",
  );
  return { file: `${ASSEMBLIES_DIR}/${id}.yaml`, members };
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
  rmSync(path, { force: true });
  return `${ASSEMBLIES_DIR}/${id}.yaml`;
}

/** A node was RENAMED: every box holding it follows, since a member is a reference we can write back. */
export function renameNodeInAssemblies(
  dir: string,
  from: string,
  to: string,
): string[] {
  const touched: string[] = [];
  for (const a of assembliesNaming(dir, from)) {
    const path = join(dir, a.file);
    const text = readFileSync(path, "utf8");
    const next = renameAssemblyMember(text, from, to);
    if (next === text) continue;
    writeFileSync(path, next, "utf8");
    touched.push(a.id);
  }
  return touched;
}

/** …and a node DELETED: the member goes, and the box with it once it has no members left. */
export function dropNodeFromAssemblies(dir: string, node: string): string[] {
  const touched: string[] = [];
  for (const a of assembliesNaming(dir, node)) {
    const path = join(dir, a.file);
    const parsed = parseAssembly(readFileSync(path, "utf8"));
    if (!parsed.value) continue;
    const members = Object.fromEntries(
      Object.entries(parsed.value.members).filter(([, n]) => n !== node),
    );
    // A box about nothing is not a box: the last member out takes the record with it.
    if (!Object.keys(members).length) rmSync(path, { force: true });
    else
      writeFileSync(
        path,
        formatAssembly({ uses: parsed.value.uses, members }),
        "utf8",
      );
    touched.push(a.id);
  }
  return touched;
}
