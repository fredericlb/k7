// uiMigrate.ts — move the `ui:` blocks that still live inside module files out into a `ui.yaml` beside each
// one. A one-shot, re-runnable: a module with no `ui:` left is already migrated and is skipped, so running it
// twice does nothing the first run didn't. Rationale: docs/uiLibrary.md.

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { MODULE_TYPES, moduleRefOf } from "./loader";
import { moduleNamespaceOf } from "./sharedFolders";
import { writeUiFile } from "./uiLibrary";
import { setModuleValue } from "./yaml/moduleFile";
import { moduleFileFor } from "./yaml/moduleIO";
import { type ModuleUI, UISchema } from "./yaml/moduleSchema";

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

/**
 * Every module file under `root` that could hold a panel.
 *
 * Two shapes, because the two trees differ: a project's `modules/<type>/<name>/module.yaml` (ref
 * `<type>/<name>`) and a shared `_modules/<type>/[<category>/]<leaf>/module.yaml` (ref `@<ns>/<type>/<sub>`).
 * Instances are left out — their `ui:` never had an effect, so migrating one would CREATE a panel that never
 * showed, and give it the generic's ref.
 */
function candidatesIn(
  base: string,
  ns: string | null,
  rel: (p: string) => string,
): Candidate[] {
  const out: Candidate[] = [];
  for (const type of Object.keys(MODULE_TYPES)) {
    const typeDir = join(base, type);
    if (!existsSync(typeDir) || !statSync(typeDir).isDirectory()) continue;
    const visit = (folder: string, sub: string): void => {
      const file = moduleFileFor(folder, "", "module");
      if (file) {
        out.push({
          path: file.path,
          ref: ns ? `@${ns}/${type}/${sub}` : moduleRefOf(type, sub),
          label: rel(file.path),
        });
        return; // a module folder, not a category — no nesting below it
      }
      if (ns === null) return; // a project files modules one level deep only
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

/**
 * Move every inline `ui:` under this project's workspace into the `ui.yaml` beside its module, and delete it
 * from the module file.
 *
 * Both halves are covered: the project's own `modules/`, and the shared `_modules/` beside it. The shared one
 * is written to even though the library is read-only through the file service — this is the same kind of
 * operation as `module populate`, run deliberately and not as a side effect of a save.
 *
 * The module file is edited with setModuleValue, so removing the block is a one-key diff: every comment, key
 * order and layout choice around it survives.
 */
export function migrateModuleUis(dir: string): UiMigration {
  const out: UiMigration = { moved: [], skipped: [], errors: [] };

  const roots: { base: string; ns: string | null; label: string }[] = [
    { base: join(dir, "modules"), ns: null, label: "modules" },
  ];
  // The workspace's library is `@workspace` because of where it sits. It used to have to declare
  // that in a config.yaml, and a folder without one was reported here and skipped — a real
  // migration refusing to run over a real library. There is nothing left to declare, so the
  // folder existing is the whole condition.
  const shared = join(dir, "..", "_modules");
  if (existsSync(shared))
    roots.push({
      base: shared,
      ns: moduleNamespaceOf(shared),
      label: "_modules",
    });

  for (const { base, ns, label } of roots) {
    if (!existsSync(base)) continue;
    const rel = (p: string) =>
      `${label}/${relative(base, p).split(sep).join("/")}`;
    for (const c of candidatesIn(base, ns, rel)) {
      let text: string;
      try {
        text = readFileSync(c.path, "utf8");
      } catch (e) {
        out.errors.push(`${c.label}: ${(e as Error).message}`);
        continue;
      }
      // Read the block out of the PARSED file rather than the text, so an anchor or a flow map arrives as a
      // value and not as a substring to be re-parsed.
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
        writeFileSync(c.path, setModuleValue(text, ["ui"], null), "utf8");
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

/**
 * The file's own `ui:` block as a plain value, or null when it has none.
 *
 * Read schema-free, on purpose: a module file that fails validation for an unrelated reason still has a panel
 * worth rescuing, and refusing to migrate it would strand that panel in a file nothing reads.
 */
function readInlineUi(text: string): unknown {
  const doc = parseYaml(text, { version: "1.2" }) as { ui?: unknown } | null;
  return doc?.ui ?? null;
}
