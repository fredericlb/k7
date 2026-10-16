// diagnostics.ts — the located findings a project's files earn short of failing the compile: a
// library module that would not read, a field nothing reads, a plugin k7 cannot load. What a
// reader gets wrong: "accepted" must never quietly mean "ignored". See docs/loader.md.

import { NOT_SUPPORTED_TYPE } from "@studio/song-schema/moduleTypes";
import { loadProjectRoot } from "./entities";
import { loadModuleRefs } from "./moduleRefs";
import { resolveModuleMap } from "./moduleResolve";
import { loadModules } from "./moduleTree";
import type { RawProjectRoot } from "./rawDoc";
import { entityFileFor } from "./yaml/moduleIO";

/** One located finding for the editor's inline squiggles; mirrored on the wire by web-shared's Diagnostic. */
export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  message: string;
  severity?: "error" | "warning";
}

// The modules of the inherited libraries that would not READ — a warning, becoming an error only once named (docs/graphModel.md).
export function libraryModuleIssues(dir: string): Diagnostic[] {
  const issues: Diagnostic[] = [];
  loadModuleRefs(dir, undefined, issues);
  return issues;
}

// Fields a project may still declare that nothing reads, so "accepted" never quietly means "ignored" (docs/sharedFolders.md).
export function deadProjectFields(dir: string): Diagnostic[] {
  let root: RawProjectRoot;
  try {
    root = loadProjectRoot(dir);
  } catch {
    return []; // an unreadable header is the compile's error, not this
  }
  const project = root.project as Record<string, unknown> | undefined;
  // Project-RELATIVE, like every other Diagnostic, because the editor matches these against its own tree paths.
  const file = (
    entityFileFor(dir, "", "project")?.rel ?? "project.yaml"
  ).replace(/^\/+/, "");
  const at = (message: string): Diagnostic => ({
    file,
    line: 1,
    col: 1,
    severity: "warning",
    message,
  });
  const dead = (["modules_from", "libraries_from"] as const)
    .filter((k) => project?.[k] !== undefined)
    .map((k) =>
      at(
        `\`${k}\` is no longer read — the shared folders are found where they sit (../_modules, ../_library, the médiathèque). This line can be deleted.`,
      ),
    );
  // A ROOT sibling rather than a `project:` setting, which is why it is asked separately.
  if (root.type !== undefined)
    dead.push(
      at(
        "`type` is no longer read — the folder's suffix is what says which app opens a project, and there is one dialect left. This line can be deleted.",
      ),
    );
  return dead;
}

export function notSupportedModules(dir: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const authored = loadModules(dir); // authored, no validate
  // RESOLVED, because the marker may be INHERITED: a node on `@meta/not-supported` need not restate it (docs/notSupported.md).
  const resolved = resolveModuleMap(authored, loadModuleRefs(dir));
  for (const [name, m] of Object.entries(resolved)) {
    const p = m?.plugin;
    if (!p || typeof p !== "object") continue;
    if (String(p.type ?? "").toLowerCase() !== NOT_SUPPORTED_TYPE) continue;
    const own = authored[name];
    out.push({
      // The entry's OWN file, not the generic's — and a node's is flat, with no type folder in it.
      file:
        own?.home === "nodes"
          ? `nodes/${own.file}.yaml`
          : `modules/${m.category}/${m.file}/${m.node ?? "module"}.yaml`,
      line: 1,
      col: 1,
      severity: "warning",
      message: `plugin "${p.name || name}" is not supported — it will be bypassed`,
    });
  }
  return out;
}
