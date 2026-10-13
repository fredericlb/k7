// uiMigrate.ts — move the `ui:` blocks that still live inside module files out into a `ui.yaml` beside each
// one. A one-shot, re-runnable: a module with no `ui:` left is already migrated and is skipped, so running it
// twice does nothing the first run didn't. Rationale: docs/uiLibrary.md.

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { setModuleValue } from "@studio/song-schema/yaml/moduleFile";
import { type ModuleUI, UISchema } from "@studio/song-schema/yaml/moduleSchema";
import { parse as parseYaml } from "yaml";
import { MODULE_TYPES } from "./loader";
import { moduleNamespaceOf } from "./sharedFolders";
import { writeUiFile } from "./uiLibrary";
import { moduleFileFor } from "./yaml/moduleIO";
import { wsExists, wsRead, wsWrite } from "./yaml/workspaceFile";

export interface UiMigration {
  /** Panels written, as `<ref> → <library>/<path>`. */
  moved: string[];
  /** Module files that had no `ui:` to move, or whose panel was already in the library. */
  skipped: string[];
  errors: string[];
}

/** One module file worth migrating: where it is, and the ref its panel will name. */
interface Candidate {
  path: string;
  ref: string;
  label: string; // what a report calls it
}

/** Every module file under `root` that could hold a panel — two tree shapes, and NODES left out. */
function candidatesIn(
  base: string,
  ns: string,
  rel: (p: string) => string,
): Candidate[] {
  const out: Candidate[] = [];
  for (const type of Object.keys(MODULE_TYPES)) {
    const typeDir = join(base, type);
    if (!wsExists(typeDir) || !statSync(typeDir).isDirectory()) continue;
    const visit = (folder: string, sub: string): void => {
      const file = moduleFileFor(folder, "", "module");
      if (file) {
        out.push({
          path: file.path,
          ref: `@${ns}/${type}/${sub}`,
          label: rel(file.path),
        });
        return; // a module folder, not a category — no nesting below it
      }
      for (const leaf of readdirSync(folder)) {
        const at = join(folder, leaf);
        if (statSync(at).isDirectory()) visit(at, `${sub}/${leaf}`);
      }
    };
    for (const name of readdirSync(typeDir)) {
      const at = join(typeDir, name);
      if (statSync(at).isDirectory()) visit(at, name);
    }
  }
  return out;
}

/** Move every inline `ui:` into the `ui.yaml` beside its module, as a one-key diff — docs/uiLibrary.md. */
export function migrateModuleUis(dir: string): UiMigration {
  const out: UiMigration = { moved: [], skipped: [], errors: [] };

  const roots: { base: string; ns: string; label: string }[] = [];
  // Nothing left to declare, so the folder existing is the whole condition (docs/sharedFolders.md).
  const shared = join(dir, "..", "_modules");
  if (wsExists(shared))
    roots.push({
      base: shared,
      ns: moduleNamespaceOf(shared),
      label: "_modules",
    });

  for (const { base, ns, label } of roots) {
    if (!wsExists(base)) continue;
    const rel = (p: string) =>
      `${label}/${relative(base, p).split(sep).join("/")}`;
    for (const c of candidatesIn(base, ns, rel)) {
      let text: string;
      try {
        text = wsRead(c.path);
      } catch (e) {
        out.errors.push(`${c.label}: ${(e as Error).message}`);
        continue;
      }
      // Read out of the PARSED file, so an anchor or a flow map arrives as a value, not a substring.
      const raw = readInlineUi(text);
      if (!raw) {
        out.skipped.push(c.label);
        continue;
      }
      const parsed = UISchema.safeParse(raw);
      if (!parsed.success) {
        out.errors.push(
          `${c.label}: ui is not a panel this can move (${parsed.error.issues[0]?.message})`,
        );
        continue;
      }
      try {
        const written = writeUiFile(
          dir,
          c.ref,
          parsed.data as ModuleUI,
          `panel for ${c.ref}`,
        );
        wsWrite(c.path, setModuleValue(text, ["ui"], null));
        out.moved.push(
          `${c.ref} → ${label}/${relative(base, written).split(sep).join("/")}`,
        );
      } catch (e) {
        out.errors.push(`${c.label}: ${(e as Error).message}`);
      }
    }
  }
  return out;
}

/** The file's own `ui:` block, read SCHEMA-FREE so an otherwise invalid module's panel is still rescued. */
function readInlineUi(text: string): unknown {
  const doc = parseYaml(text, { version: "1.2" }) as { ui?: unknown } | null;
  return doc?.ui ?? null;
}
