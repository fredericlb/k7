// diagnostics.ts — the located findings a project's files earn short of failing the compile: a
// library module that would not read, a field nothing reads, a plugin k7 cannot load. What a
// reader gets wrong: "accepted" must never quietly mean "ignored". See docs/loader.md.

import {
  hostsPlugin,
  NOT_SUPPORTED_TYPE,
  OFFLINE_TYPE,
} from "@studio/song-schema/moduleTypes";
import { reachesEngine } from "./compile/plugins";
import { loadProjectRoot } from "./entities";
import { loadModuleRefs } from "./moduleRefs";
import { resolveModuleMap } from "./moduleResolve";
import { loadModules } from "./moduleTree";
import type { LoadedModule, RawProjectRoot } from "./rawDoc";
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
    entityFileFor(dir, "", "project")?.rel ?? "project.k7x"
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

type PluginRef = { type?: unknown; name?: unknown };

// One finding per project module whose RESOLVED plugin `judge` has something to say about, at the entry's own file.
function pluginFindings(
  dir: string,
  judge: (
    p: PluginRef,
    name: string,
    m: LoadedModule,
  ) => Pick<Diagnostic, "message" | "severity"> | null,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const authored = loadModules(dir); // authored, no validate
  // RESOLVED, because the plugin may be INHERITED: a node on `@meta/not-supported` need not restate it (docs/notSupported.md).
  const resolved = resolveModuleMap(authored, loadModuleRefs(dir));
  for (const [name, m] of Object.entries(resolved)) {
    const p = m?.plugin as PluginRef | undefined;
    if (!p || typeof p !== "object") continue;
    const finding = judge(p, name, m);
    if (!finding) continue;
    const own = authored[name];
    out.push({
      // The entry's OWN file, not the generic's — and a node's is flat, with no type folder in it.
      file:
        own?.home === "nodes"
          ? `nodes/${own.file}.k7x`
          : `modules/${m.category}/${m.file}/${m.node ?? "module"}.k7x`,
      line: 1,
      col: 1,
      ...finding,
    });
  }
  return out;
}

export function notSupportedModules(dir: string): Diagnostic[] {
  return pluginFindings(dir, (p, name) =>
    String(p.type ?? "").toLowerCase() === NOT_SUPPORTED_TYPE
      ? {
          severity: "warning",
          message: `plugin "${p.name || name}" is not supported — it will be bypassed`,
        }
      : null,
  );
}

// A plugin type no engine loads compiles to NOTHING, so it is said here as an error rather than played as silence (docs/loader.md).
export function unknownPluginModules(dir: string): Diagnostic[] {
  return pluginFindings(dir, (p, name, m) => {
    if (m.kind !== "plugin" || !hostsPlugin(m.category)) return null;
    const type = String(p.type ?? "").toLowerCase();
    if (
      type === NOT_SUPPORTED_TYPE ||
      type === OFFLINE_TYPE ||
      reachesEngine(type)
    )
      return null;
    return {
      severity: "error",
      message: `plugin "${p.name || name}" has type "${String(p.type ?? "")}", which no engine loads — it plays nothing (a built-in is "internal")`,
    };
  });
}
