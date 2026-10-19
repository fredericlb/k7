// assemblyFile.ts — reading and EDITING the two assembly files. Browser-safe (no fs), like
// surfaceFile.ts beside it, because the screen that draws a box is the one that resolves it.
// Every write goes through a k7x document scope: these files are read by people and are in git,
// so a member rename must change one value and leave every comment where it was.
// Full rationale: packages/song/docs/assemblies.md.

import type { K7Scope } from "@studio/k7x/document";
import { stringify } from "@studio/k7x/print";
import type { Diagnostic } from "@studio/web-protocol";
import {
  ASSEMBLIES_DIR,
  ASSEMBLY_FILE,
  type AssemblyFile,
  AssemblyFileSchema,
  type AssemblyParam,
  type AssemblyTemplate,
  AssemblyTemplateSchema,
} from "./assemblySchema";
import { readK7x } from "./k7xIssues";
import { k7xSchemaIssues, type SchemaIssue } from "./k7xPosition";
import type { ModuleIssue } from "./moduleFile";

export { ASSEMBLIES_DIR, ASSEMBLY_FILE };

/** One assembly as a reader gets it, its id being its FILENAME — a WIRE shape. */
export interface ProjectAssembly {
  id: string;
  /** Project-relative, for a diagnostic the editor can match against its tree. */
  file: string;
  assembly: AssemblyFile;
}

/** Every assembly a project declares, plus whatever would not read. */
export interface ProjectAssemblies {
  assemblies: ProjectAssembly[];
  diagnostics: Diagnostic[];
}

export interface ParsedAssembly<T> {
  value: T | null;
  issues: ModuleIssue[];
}

type Schema<T> = {
  safeParse: (raw: unknown) => {
    success: boolean;
    data?: T;
    error?: { issues: readonly SchemaIssue[] };
  };
};

/** The shared half of both parsers: the syntax error, an empty file, then the schema's findings, each on its line. */
function parseWith<T>(
  text: string,
  schema: Schema<T>,
  empty: string,
): ParsedAssembly<T> {
  const read = readK7x(text);
  const { doc } = read;
  if (!doc) return { value: null, issues: read.issues };
  if (!doc.contents?.entries.length)
    return { value: null, issues: [{ path: "", message: empty }] };
  const result = schema.safeParse(read.data);
  if (!result.success)
    return {
      value: null,
      issues: k7xSchemaIssues(doc, result.error?.issues ?? []),
    };
  return { value: result.data as T, issues: [] };
}

/** Parse a library template's k7x text — the plugs and the promoted params. */
export function parseAssemblyTemplate(
  text: string,
): ParsedAssembly<AssemblyTemplate> {
  return parseWith(
    text,
    AssemblyTemplateSchema,
    "an assembly declares its plugs (`inputs` / `outputs`) and the params it promotes (`params`).",
  );
}

/** Parse a project's `assemblies/<name>` k7x text — the template it uses and which nodes are its members. */
export function parseAssembly(text: string): ParsedAssembly<AssemblyFile> {
  return parseWith(
    text,
    AssemblyFileSchema,
    "an assembly instance says `uses` (a template ref) and `members` (template name -> node name).",
  );
}

/** The instance file as this library writes one, `header` its `//` lines — what `assembly new` emits. */
export function formatAssembly(
  file: AssemblyFile,
  header: readonly string[] = [],
): string {
  return stringify({ uses: file.uses, members: file.members }, { header });
}

/** Refuse early rather than write over a file that does not read as its kind. */
function check(doc: K7Scope, template: boolean): void {
  const schema = template ? AssemblyTemplateSchema : AssemblyFileSchema;
  const result = schema.safeParse(doc.toJS() ?? {});
  const what = template ? ASSEMBLY_FILE : ASSEMBLIES_DIR;
  if (!result.success)
    throw new Error(
      `${what}: ${result.error.issues[0]?.message ?? "unreadable"}`,
    );
}

/** Point every member naming `from` at `to` — what a node RENAME does to every assembly holding it; true when one moved. */
export function renameAssemblyMember(
  doc: K7Scope,
  from: string,
  to: string,
): boolean {
  check(doc, false);
  const members = (doc.getIn(["members"]) ?? {}) as Record<string, unknown>;
  let touched = false;
  for (const [key, node] of Object.entries(members)) {
    if (node !== from) continue;
    doc.setIn(["members", key], to);
    touched = true;
  }
  return touched;
}

/** Promote a member's param onto the box's face, or replace what that name already promoted. */
export function setAssemblyParam(
  doc: K7Scope,
  name: string,
  target: AssemblyParam,
): void {
  check(doc, true);
  doc.setIn(["params", name], { node: target.node, param: target.param });
}

/** …and take it back off, the empty map going with the last entry; true when there was one to take. */
export function dropAssemblyParam(doc: K7Scope, name: string): boolean {
  check(doc, true);
  if (!doc.hasIn(["params", name])) return false;
  doc.deleteIn(["params", name], { prune: true });
  return true;
}
