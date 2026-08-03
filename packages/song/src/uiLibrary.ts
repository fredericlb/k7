// uiLibrary.ts — a module's panel: the `ui.yaml` that sits BESIDE its `module.yaml`, in the same folder. What
// the module's `ui:` block used to be, in a file of its own, so the plugin scan can rewrite what a module IS
// without touching how it is DRAWN. The FOLDER says which module a panel belongs to; the file only says how it
// looks. Read across every module library the project can see, nearest first. Rationale: docs/uiLibrary.md.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { MODULE_TYPES, moduleRefOf } from "./moduleTypes";
import {
  moduleLibraryDirs,
  moduleNamespaceOf,
  modulePanelRoots,
} from "./sharedFolders";
import { moduleFileFor, UI_BASE } from "./yaml/moduleIO";
import { type ModuleUI, UiFileSchema } from "./yaml/moduleSchema";
import { parseUiFile } from "./yaml/uiFile";

/** The panel file a module folder holds, as it is written. `.yml` is read too (moduleFileFor probes both). */
export const UI_FILE = `${UI_BASE}.yaml`;

export interface UiEntry {
  ref: string;
  ui: ModuleUI;
  /** Absolute path of the file it came from. */
  path: string;
}

export interface UiLibrary {
  /** By module ref — what every consumer looks a panel up by. */
  byRef: Record<string, UiEntry>;
  /** Unreadable files, reported rather than thrown: one bad panel must not hide the rest. */
  issues: string[];
}

/**
 * Where a ref's panel sits, relative to the module library that holds the module.
 *
 * The namespace is dropped because it names the LIBRARY, which the caller has already picked:
 * `@engine/audio/delay/tape-delay` and a project's own `audio/reverb` each land beside their module file. An io
 * module's ref carries no type folder (`desk`), so it gets one back — without that the panel would land at the
 * library root instead of in `io/desk/`. The `ui/` tree is gone, but that rescue is not: it is about the REF's
 * shape, not about where the file lives.
 */
export function uiPathFor(ref: string): string {
  const bare = ref.startsWith("@") ? ref.split("/").slice(1).join("/") : ref;
  const withType = bare.includes("/") ? bare : `io/${bare}`;
  return `${withType}/${UI_FILE}`;
}

/**
 * Read every panel the project can see, keyed by the ref of the module whose folder each one sits in.
 *
 * More than one library: the project's own `modules/`, then each library `modules_from` names — `_modules` and
 * the mediatek, typically. NEAREST WINS, so a project that forked a shared module draws its own face rather than
 * the one it was copied from.
 */
export function loadUiLibrary(dir: string): UiLibrary {
  const out: UiLibrary = { byRef: {}, issues: [] };
  // The project's OWN `modules/` is the `@project` level, and `panelsIn` reads a null namespace as
  // exactly that: bare refs, and no category folder in between. It used to fall out of
  // `moduleNamespaceOf` returning null for a root with no config; that function answers from
  // LOCATION now and always names a level, so the one root that is not a library is named here.
  const own = resolve(join(dir, "modules"));
  for (const root of modulePanelRoots(dir)) {
    const ns = resolve(root) === own ? null : moduleNamespaceOf(root);
    const label = basename(root);
    for (const { ref, path, rel } of panelsIn(root, ns)) {
      if (out.byRef[ref]) continue; // a nearer library already answered — that is precedence working
      const parsed = parseUiFile(readFileSync(path, "utf8"));
      if (!parsed.value) {
        out.issues.push(
          `${label}/${rel}: ${parsed.issues[0]?.message ?? "unreadable"}`,
        );
        continue;
      }
      out.byRef[ref] = { ref, ui: parsed.value, path };
    }
  }
  return out;
}

/**
 * Every `ui.yaml` under one module library, with the ref its folder gives it.
 *
 * Two depths, because the two trees differ: a project files modules one level under the type folder, a shared
 * library may put one category folder in between. Mirrors the loaders' own walk rather than guessing at it, so a
 * folder this hands back a ref for is a folder loadModules and loadModuleRefs agree about.
 */
function panelsIn(
  root: string,
  ns: string | null,
): { ref: string; path: string; rel: string }[] {
  const out: { ref: string; path: string; rel: string }[] = [];
  const at = (folder: string, rel: string, ref: string): void => {
    const file = moduleFileFor(folder, rel, UI_BASE);
    if (file)
      out.push({ ref, path: file.path, rel: `${rel}/${basename(file.path)}` });
  };
  const dirs = (abs: string): string[] => {
    try {
      return readdirSync(abs).filter((n) =>
        statSync(join(abs, n)).isDirectory(),
      );
    } catch {
      return []; // unreadable folder — the rest of the library still loads
    }
  };
  for (const type of Object.keys(MODULE_TYPES)) {
    const typeDir = join(root, type);
    if (!existsSync(typeDir)) continue;
    for (const name of dirs(typeDir)) {
      const folder = join(typeDir, name);
      at(
        folder,
        `${type}/${name}`,
        ns ? `@${ns}/${type}/${name}` : moduleRefOf(type, name),
      );
      // A category folder, one level deep only — and only in a shared library, which is the
      // one shape that files a module under `<type>/<category>/<leaf>`.
      if (!ns) continue;
      for (const leaf of dirs(folder))
        at(
          join(folder, leaf),
          `${type}/${name}/${leaf}`,
          `@${ns}/${type}/${name}/${leaf}`,
        );
    }
  }
  return out;
}

/** Serialise a panel as a `ui.yaml`. The header is the only place the module is named — a comment, because the
 *  folder is what actually says it, and two sources of truth is one too many. */
export function uiFileText(ui: ModuleUI, header?: string): string {
  // Validated on the way out as well as in: a panel this can't read back is a file the editor would refuse.
  UiFileSchema.parse(ui);
  const body = stringifyUi(ui);
  return header ? `# ${header}\n${body}` : body;
}

/**
 * Write a panel into its module's folder, returning the absolute path it landed in.
 *
 * There is no "write to my own library instead" any more: a panel goes where its module is, including in a
 * shared one. That is the point of putting the two files together — a face is drawn once for the plugin every
 * song reaches for, not once per project that plays it.
 */
export function writeUiFile(
  dir: string,
  ref: string,
  ui: ModuleUI,
  header?: string,
): string {
  const path = join(moduleRootFor(dir, ref), uiPathFor(ref));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, uiFileText(ui, header ?? `panel for ${ref}`), "utf8");
  return path;
}

/**
 * The library that holds `ref` — the project's own for a bare or `@project` ref, otherwise the root whose
 * LOCATION gives it that namespace. Throws rather than guessing: a panel written under the wrong root draws a
 * module that isn't there.
 *
 * `@engine/<slug>` is the ref that has no answer here, and deliberately so: an engine module is a scanned
 * plugin, with no folder in any library (see engineCatalogue.ts). A panel now needs a folder to sit in, so a
 * plugin the engine merely reports cannot have one until somebody makes it a module. Better a refusal that says
 * so than a file written under `io/`, which is where the io rescue would put it.
 */
function moduleRootFor(dir: string, ref: string): string {
  if (!ref.startsWith("@")) return join(dir, "modules");
  const ns = ref.slice(1).split("/")[0];
  // `@project/audio/reverb` is the same module as the bare `audio/reverb` — the explicit spelling of the
  // level the project owns. It names no library, so it never matches a root below and would be refused.
  if (ns === "project") return join(dir, "modules");
  for (const root of moduleLibraryDirs(dir))
    if (moduleNamespaceOf(root) === ns) return root;
  throw new Error(
    `${ref}: no module library this project can see declares '@${ns}', so there is no folder to draw it in`,
  );
}

// --- serialisation ------------------------------------------------------------

/**
 * Emit the panel as YAML, with each widget on ONE flow line.
 *
 * Hand-written rather than `yaml`'s stringify because a widget is read as a row — eight scalars describing one
 * knob — and the block form the library would produce turns a 20-line panel into 200 lines nobody scans. This
 * is the shape the existing module files already use.
 */
function stringifyUi(doc: {
  cols: number;
  rows: number;
  widgets: Record<string, unknown>;
}): string {
  const scalar = (v: unknown): string => {
    if (typeof v === "string")
      return /^[A-Za-z0-9_][A-Za-z0-9 _.\-+]*$/.test(v) &&
        !/^(y|n|yes|no|on|off|true|false|null)$/i.test(v)
        ? v
        : JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map(scalar).join(", ")}]`;
    if (v && typeof v === "object")
      return `{ ${Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .map(([k, x]) => `${k}: ${scalar(x)}`)
        .join(", ")} }`;
    return String(v);
  };
  const ids = Object.entries(doc.widgets);
  const lines = [
    `cols: ${doc.cols}`,
    `rows: ${doc.rows}`,
    // `{}` and not a bare `widgets:`, which YAML reads back as NULL — and a null fails the schema, so a panel
    // with no widgets yet read as MALFORMED and the editor greyed its own grid out. That is the scaffold every
    // module without a panel gets, which is precisely when the grid is needed.
    ids.length ? "widgets:" : "widgets: {}",
  ];
  for (const [id, w] of ids)
    lines.push(
      `  ${/^[A-Za-z0-9_-]+$/.test(id) ? id : JSON.stringify(id)}: ${scalar(w)}`,
    );
  return `${lines.join("\n")}\n`;
}
