// moduleRefs.ts — every module a project can name by REF: its libraries, the engine's scan and
// the built-ins, plus the base-module lists a picker draws. What a reader gets wrong: the map is
// memoised on the module folders' stamp, because it reads hundreds of files. See docs/moduleCache.md.

import { join } from "node:path";
import {
  FAUST_FILE,
  FAUST_TYPE,
  JSDSP_FILE,
  JSDSP_TYPE,
} from "@studio/engine-protocol/build";
import {
  COLD_TYPE,
  CONSOLE_TYPE,
  splitModuleKey,
} from "@studio/song-schema/moduleTypes";
import type { Diagnostic } from "./diagnostics";
import { docModules } from "./docModule";
import { engineModules, ioModules } from "./engineCatalogue";
import { cachedForModules } from "./moduleCache";
import { resolveModuleRef } from "./moduleResolve";
import { applyUiLibrary, cloneModules, readModuleTree } from "./moduleTree";
import { notSupportedRefs } from "./notSupportedModule";
import type { LoadedModule } from "./rawDoc";
import {
  META_MODULES_ROOT,
  moduleLibraryDirs,
  moduleNamespaceOf,
} from "./sharedFolders";
import { trackModules } from "./trackModule";

// The DSP source of a module, resolved against its own folder, with the PLUGIN TYPE deciding the filename (docs/graphModel.md).
export function dspSourceFor(
  value: Record<string, unknown>,
  folder: string,
): Pick<LoadedModule, "jsdsp" | "faust"> {
  const type = String(
    (value.plugin as { type?: unknown } | undefined)?.type ?? "",
  );
  if (type === JSDSP_TYPE) return { jsdsp: join(folder, JSDSP_FILE) };
  if (type === FAUST_TYPE) return { faust: join(folder, FAUST_FILE) };
  return {};
}

// Every module referenceable by REF, memoised on the module folders' stamp because it reads ~700 k7x files (docs/moduleCache.md).
export function loadModuleRefs(
  dir: string,
  // The ENGINE's own modules, injected because what this machine offers is AMBIENT state a test must be able to withhold.
  catalogue?: Record<string, LoadedModule>,
  // Where a library module that would not read is reported; optional, since only a caller that REPORTS passes an array.
  issues: Diagnostic[] = [],
): Record<string, LoadedModule> {
  if (catalogue === undefined) {
    const hit = cachedForModules(dir, "refs", () => {
      const found: Diagnostic[] = [];
      return {
        out: readModuleRefs(dir, engineModules(), found),
        issues: found,
      };
    });
    issues.push(...hit.issues);
    return cloneModules(hit.out);
  }
  return readModuleRefs(dir, catalogue, issues);
}

function readModuleRefs(
  dir: string,
  catalogue: Record<string, LoadedModule>,
  issues: Diagnostic[],
): Record<string, LoadedModule> {
  // The built-ins first, then the catalogue, so anything on disk overrides both — see docs/graphModel.md.
  const out: Record<string, LoadedModule> = {
    ...docModules(),
    ...trackModules(),
    ...notSupportedRefs(),
    ...ioModules(),
    ...catalogue,
  };

  // The shared roots, found by location (docs/sharedFolders.md), then `@meta` last, which no library may be named.
  for (const root of [...moduleLibraryDirs(dir), META_MODULES_ROOT]) {
    // The level comes from WHERE the root is, not from anything it declares — see moduleNamespaceOf.
    const ns = moduleNamespaceOf(root);
    readModuleTree(
      root,
      "",
      (type, name) => `@${ns}/${type}/${name}`,
      out,
      issues,
      dir,
    );
  }

  // Panels come from the `ui.k7x` beside each module, keyed by these refs MINUS the node — see docs/uiLibrary.md.
  applyUiLibrary(dir, out, (_m, ref) => splitModuleKey(ref).module);
  return out;
}

/** The ref map for a project — every shared root it inherits; a thin alias, no root being declared. */
export const projectModules = (dir: string): Record<string, LoadedModule> =>
  loadModuleRefs(dir);

// The plugin refs a new module can `extends`: not an io module and not a node, since you extend a module and then instantiate.
export function baseModuleRefs(
  byRef: Record<
    string,
    { kind?: string; node?: string; engineOf?: string; category?: string }
  >,
): string[] {
  return (
    Object.entries(byRef)
      // Engines, console halves and cold modules are placed elsewhere (docs/engines.md, docs/console.md, docs/coldModules.md).
      .filter(
        ([, m]) =>
          m?.kind === "plugin" &&
          !m?.node &&
          !m?.engineOf &&
          m?.category !== CONSOLE_TYPE &&
          m?.category !== COLD_TYPE,
      )
      .map(([ref]) => ref)
      .sort()
  );
}

/** …for a project, loading its own modules plus everything it inherits. */
export function listBaseModules(dir: string): string[] {
  return baseModuleRefs(projectModules(dir));
}

/** One base module as a PICKER draws it: the ref it is named by, which is also the name it shows. */
export interface BaseModuleRef {
  ref: string;
  /** Its panel grid, when it draws one — what a picker sizes a card by before the node exists. */
  panel?: { cols: number; rows: number };
}

/** A module's panel grid size, or undefined for a module that draws no panel. */
export function panelOf(
  m: LoadedModule | undefined,
): { cols: number; rows: number } | undefined {
  const ui = m?.ui as { cols?: unknown; rows?: unknown } | undefined;
  const cols = Number(ui?.cols);
  const rows = Number(ui?.rows);
  return cols > 0 && rows > 0 ? { cols, rows } : undefined;
}

/** …the same list with their panels, off ONE walk — what `/base-modules` answers. */
export function listBaseModuleRefs(dir: string): BaseModuleRef[] {
  const modules = projectModules(dir);
  return baseModuleRefs(modules).map((ref) => {
    const panel = panelOf(modules[ref]);
    return { ref, ...(panel ? { panel } : {}) };
  });
}

// The modules a chain step may name: the project's own, plus only those SHARED refs the chains actually USE.
export function withChainModuleRefs(
  modules: Record<string, LoadedModule>,
  byRef: Record<string, LoadedModule>,
  chains: Record<
    string,
    { use?: { module?: string }[]; out?: { to?: string }[] } | undefined
  >,
): Record<string, LoadedModule> {
  const out = { ...modules };
  // A chain's LAST node is its sink, parsed into `out`, so a ref must arrive here from both or it works only as a step.
  const add = (raw: unknown): void => {
    const name = String(raw ?? "");
    if (!name || out[name] || !byRef[name]) return;
    out[name] = resolveModuleRef(name, byRef) ?? byRef[name];
  };
  for (const c of Object.values(chains ?? {})) {
    for (const s of c?.use ?? []) add(s?.module);
    for (const o of c?.out ?? []) add(o?.to);
  }
  return out;
}
