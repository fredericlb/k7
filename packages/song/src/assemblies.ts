// assemblies.ts — the OPTIONAL `assemblies/` folder of a project, read off the disk: one file per
// box, each naming a template in the library and which of this project's nodes are its members.
// Node-side; the parsers are browser-safe (yaml/assemblyFile.ts), so an app can read one out of
// the file service without this. Nothing here reaches the compiler: an assembly is a drawing.
// Full rationale: docs/assemblies.md.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { libraryRef, libraryRefParts } from "@studio/song-schema/moduleTypes";
import {
  ASSEMBLIES_DIR,
  ASSEMBLY_FILE,
  type ProjectAssemblies,
  type ProjectAssembly,
  parseAssembly,
  parseAssemblyTemplate,
} from "@studio/song-schema/yaml/assemblyFile";
import type {
  AssemblyPlug,
  AssemblyTemplate,
} from "@studio/song-schema/yaml/assemblySchema";
import type { Diagnostic } from "./loader";
import { libraryFamilyRoot, libraryFamilyRoots } from "./sharedFolders";
import { entityFiles } from "./yaml/moduleIO";
import { wsExists, wsRead } from "./yaml/workspaceFile";

export type { ProjectAssemblies, ProjectAssembly };
export { ASSEMBLIES_DIR, ASSEMBLY_FILE };

/** Every assembly a project declares, in filename order; an unreadable one is reported and skipped. */
export function projectAssemblies(dir: string): ProjectAssemblies {
  const assemblies: ProjectAssembly[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const { id, file } of entityFiles(
    join(dir, ASSEMBLIES_DIR),
    ASSEMBLIES_DIR,
  )) {
    const rel = file.rel.replace(/^\/+/, "");
    let text: string;
    try {
      text = wsRead(file.path);
    } catch (e) {
      diagnostics.push({
        file: rel,
        line: 1,
        col: 1,
        severity: "error",
        message: `assembly '${id}' could not be read: ${(e as Error).message}`,
      });
      continue;
    }
    const { value, issues } = parseAssembly(text);
    for (const issue of issues)
      diagnostics.push({
        file: rel,
        line: issue.line ?? 1,
        col: issue.col ?? 1,
        severity: "error",
        message: issue.path ? `${issue.path}: ${issue.message}` : issue.message,
      });
    if (value) assemblies.push({ id, file: rel, assembly: value });
  }
  return { assemblies, diagnostics };
}

/** The folder a ref names, or null — `@k7-core/turntable` is the `k7-core` library's `assemblies/turntable`. */
export function assemblyFolder(dir: string, ref: string): string | null {
  const parts = libraryRefParts(ref);
  if (!parts) return null;
  const root = libraryFamilyRoot(parts.library, ASSEMBLIES_DIR, dir);
  if (!root) return null;
  // A ref is a path under the family folder, so a `..` in it would reach out of the library.
  const segs = parts.rest.split(/[\\/]+/);
  if (segs.some((s) => !s || s === "." || s === "..")) return null;
  const folder = join(root, ...segs);
  return wsExists(join(folder, ASSEMBLY_FILE)) ? folder : null;
}

/** One template as the library holds it, or null when the ref resolves to nothing — a WARNING, never fatal. */
export function loadAssemblyTemplate(
  dir: string,
  ref: string,
): { template: AssemblyTemplate; folder: string; issues: string[] } | null {
  const folder = assemblyFolder(dir, ref);
  if (!folder) return null;
  const { value, issues } = parseAssemblyTemplate(
    wsRead(join(folder, ASSEMBLY_FILE)),
  );
  // An unreadable template is an EMPTY one with its complaint attached: the box still draws.
  return {
    template: value ?? {},
    folder,
    issues: issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)),
  };
}

/** Every assembly template the libraries hold, by ref — what a picker and the builder list. */
export function libraryAssemblies(
  dir: string,
): { ref: string; path: string }[] {
  const out: { ref: string; path: string }[] = [];
  for (const { name: library, root } of libraryFamilyRoots(
    ASSEMBLIES_DIR,
    dir,
  )) {
    // A folder holding an `assembly.yaml` IS one, and nothing inside one is another.
    const walk = (folder: string, rel: string[]): void => {
      if (wsExists(join(folder, ASSEMBLY_FILE))) {
        out.push({ ref: libraryRef(library, rel.join("/")), path: folder });
        return;
      }
      for (const name of readdirSync(folder).sort())
        if (statSync(join(folder, name)).isDirectory())
          walk(join(folder, name), [...rel, name]);
    };
    for (const name of readdirSync(root).sort())
      if (statSync(join(root, name)).isDirectory())
        walk(join(root, name), [name]);
  }
  return out;
}

/** The assemblies whose `members:` name this node — asked before it is renamed or deleted. */
export function assembliesNaming(dir: string, node: string): ProjectAssembly[] {
  return projectAssemblies(dir).assemblies.filter(({ assembly }) =>
    Object.values(assembly.members).includes(node),
  );
}

/** One PLUG, its member already resolved to the node this project calls it. */
export interface AssemblyPort {
  name: string;
  type: "audio" | "midi" | "video";
  node: string;
  port?: string;
  mandatory: boolean;
}

/** One assembly on the model: the box, with every template name already turned into a node name. */
export interface Assembly {
  uses: string;
  /** What the box is CALLED — the template's `label:`, else the instance's own id. */
  label: string;
  /** Template member name -> this project's node name, kept so the builder can read either way. */
  members: Record<string, string>;
  inputs: AssemblyPort[];
  outputs: AssemblyPort[];
  params: Record<string, { node: string; param: string }>;
  /** The template resolved to nothing: the box draws from `members:` alone — docs/assemblies.md. */
  missing?: boolean;
}

/** Every assembly a project declares, RESOLVED — what `GraphDoc` carries and `validate()` checks. */
export function resolveAssemblies(dir: string): Record<string, Assembly> {
  const out: Record<string, Assembly> = {};
  for (const { id, assembly } of projectAssemblies(dir).assemblies) {
    const loaded = loadAssemblyTemplate(dir, assembly.uses);
    const members = assembly.members;
    // A plug or a promotion naming a member this instance does not map is dropped, and reported below.
    const plugs = (raw: AssemblyPlug[] | undefined): AssemblyPort[] =>
      (raw ?? []).flatMap((p) =>
        members[p.node]
          ? [
              {
                name: p.name,
                type: p.type,
                node: members[p.node],
                ...(p.port ? { port: p.port } : {}),
                mandatory: p.mandatory !== false,
              },
            ]
          : [],
      );
    const params: Assembly["params"] = {};
    for (const [name, t] of Object.entries(loaded?.template.params ?? {}))
      if (members[t.node])
        params[name] = { node: members[t.node], param: t.param };
    out[id] = {
      uses: assembly.uses,
      label: loaded?.template.label ?? id,
      members,
      inputs: plugs(loaded?.template.inputs),
      outputs: plugs(loaded?.template.outputs),
      params,
      ...(loaded ? {} : { missing: true }),
    };
  }
  return out;
}

/** What the editor is TOLD about the assemblies: the files that would not read, and the refs that resolve to nothing. */
export function assemblyIssues(dir: string): Diagnostic[] {
  const { assemblies, diagnostics } = projectAssemblies(dir);
  for (const { id, file, assembly } of assemblies) {
    const loaded = loadAssemblyTemplate(dir, assembly.uses);
    if (!loaded) {
      diagnostics.push({
        file,
        line: 1,
        col: 1,
        // A WARNING: a new library is empty, and a box drawn from its members alone is the honest reading.
        severity: "warning",
        message:
          `assembly '${id}' uses '${assembly.uses}', which no library this project can see holds — ` +
          `its box draws its members with no plugs and no knobs (packages/song/docs/assemblies.md)`,
      });
      continue;
    }
    for (const issue of loaded.issues)
      diagnostics.push({
        file,
        line: 1,
        col: 1,
        severity: "error",
        message: `assembly '${id}': its template ${assembly.uses} will not read — ${issue}`,
      });
  }
  return diagnostics;
}
