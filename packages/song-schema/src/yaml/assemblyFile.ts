// assemblyFile.ts — reading and EDITING the two assembly files. Browser-safe (no fs), like
// surfaceFile.ts beside it, because the screen that draws a box is the one that resolves it.
// Every write goes through the yaml Document API: these files are read by people and are in git,
// so a member rename must change one scalar and leave every comment where it was.
// Full rationale: packages/song/docs/assemblies.md.

import type { Diagnostic } from "@studio/web-protocol";
import { Document, isMap, LineCounter, parseDocument } from "yaml";
import {
  ASSEMBLIES_DIR,
  ASSEMBLY_FILE,
  type AssemblyFile,
  AssemblyFileSchema,
  type AssemblyParam,
  type AssemblyTemplate,
  AssemblyTemplateSchema,
} from "./assemblySchema";
import type { ModuleIssue } from "./moduleFile";

export { ASSEMBLIES_DIR, ASSEMBLY_FILE };

// YAML 1.2, as every other file here pins it, and no wrapping so a plug stays on one line.
const OPTS = { version: "1.2" as const, lineWidth: 0 };
const OUT = { lineWidth: 0 };

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

/** The shared half of both parsers: the yaml errors, then the schema's, path and all. */
function parseWith<T>(
  text: string,
  schema: {
    safeParse: (raw: unknown) => {
      success: boolean;
      data?: T;
      error?: { issues: unknown[] };
    };
  },
  empty: string,
): ParsedAssembly<T> {
  const lines = new LineCounter();
  const doc = parseDocument(text, { ...OPTS, lineCounter: lines });
  const issues: ModuleIssue[] = [];
  for (const e of doc.errors) {
    const pos = lines.linePos(e.pos[0]);
    issues.push({ path: "", message: e.message, line: pos.line, col: pos.col });
  }
  if (issues.length) return { value: null, issues };

  const raw = doc.toJS();
  if (raw === null || raw === undefined)
    return { value: null, issues: [{ path: "", message: empty }] };
  if (typeof raw !== "object" || Array.isArray(raw))
    return {
      value: null,
      issues: [{ path: "", message: `${empty} This one is a list.` }],
    };

  const result = schema.safeParse(raw);
  if (!result.success) {
    for (const issue of result.error?.issues ?? []) {
      // `.strict()` reports an unknown key on the OBJECT, so the name is in `keys` rather than the path.
      const i = issue as { path: unknown[]; message: string; keys?: string[] };
      const path = [...i.path, ...(i.keys?.length ? [i.keys[0]] : [])];
      issues.push({ path: path.map(String).join("."), message: i.message });
    }
    return { value: null, issues };
  }
  return { value: result.data as T, issues: [] };
}

/** Parse a library `assembly.yaml` — the plugs and the promoted params. */
export function parseAssemblyTemplate(
  text: string,
): ParsedAssembly<AssemblyTemplate> {
  return parseWith(
    text,
    AssemblyTemplateSchema,
    "an assembly declares its plugs (`inputs:` / `outputs:`) and the params it promotes (`params:`).",
  );
}

/** Parse a project `assemblies/<name>.yaml` — the template it uses and which nodes are its members. */
export function parseAssembly(text: string): ParsedAssembly<AssemblyFile> {
  return parseWith(
    text,
    AssemblyFileSchema,
    "an assembly instance says `uses:` (a template ref) and `members:` (template name -> node name).",
  );
}

/** The instance file as this library writes one — what `assembly new` and the migrations emit. */
export function formatAssembly(file: AssemblyFile, header = ""): string {
  const doc = new Document({ uses: file.uses, members: file.members }, OPTS);
  return (
    (header
      ? `${header}
`
      : "") + doc.toString(OUT)
  );
}

/** Read a file we are about to edit, refusing early rather than writing over something unreadable. */
function read(text: string, what: string): ReturnType<typeof parseDocument> {
  const { value, issues } =
    what === ASSEMBLY_FILE ? parseAssemblyTemplate(text) : parseAssembly(text);
  if (!value) throw new Error(`${what}: ${issues[0]?.message ?? "unreadable"}`);
  return parseDocument(text, OPTS);
}

/** Point one member at a different node — what a node RENAME does to every assembly holding it. */
export function renameAssemblyMember(
  text: string,
  from: string,
  to: string,
): string {
  const doc = read(text, "assembly");
  const members = doc.get("members");
  if (!isMap(members)) return text;
  let touched = false;
  for (const pair of members.items) {
    const key = String((pair.key as { value?: unknown })?.value ?? pair.key);
    if (
      String((pair.value as { value?: unknown })?.value ?? pair.value) !== from
    )
      continue;
    members.set(key, to);
    touched = true;
  }
  return touched ? doc.toString(OUT) : text;
}

/** Which of this instance's members is that node, if any — the inverse the rename above walks. */
export function memberNamed(
  file: AssemblyFile,
  node: string,
): string | undefined {
  return Object.entries(file.members).find(([, n]) => n === node)?.[0];
}

/** Promote a member's param onto the box's face, or replace what that name already promoted. */
export function setAssemblyParam(
  text: string,
  name: string,
  target: AssemblyParam,
): string {
  const doc = read(text, ASSEMBLY_FILE);
  if (!isMap(doc.get("params"))) doc.set("params", doc.createNode({}));
  const node = doc.createNode({ node: target.node, param: target.param });
  node.flow = true;
  doc.setIn(["params", name], node);
  return doc.toString(OUT);
}

/** …and take it back off, the empty map going with the last entry — an authored-then-emptied `params:` says nothing. */
export function dropAssemblyParam(text: string, name: string): string {
  const doc = read(text, ASSEMBLY_FILE);
  const params = doc.get("params");
  if (!isMap(params)) return text;
  if (!params.has(name)) return text;
  params.delete(name);
  if (!params.items.length) doc.delete("params");
  return doc.toString(OUT);
}
