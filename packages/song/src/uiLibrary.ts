// uiLibrary.ts — a module's panel, kept OUTSIDE the module. `_ui/` sits beside `_modules/` at the workspace
// root and mirrors its tree; each file is what a module's `ui:` block used to be, plus a `ref:` naming the
// module it draws. The ref is what's looked up — the path is filing, so a file can be moved or renamed freely.
// This is what the module editor writes and what the graph reads. Rationale: docs/uiLibrary.md.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { type ModuleUI, UiFileSchema } from "./yaml/moduleSchema";
import { parseUiFile } from "./yaml/uiFile";

/** Where the shared UI library sits, relative to a project — the sibling of `_modules/`. */
export const SHARED_UI_PATH = "../_ui";

/** The folder name a UI library lives under, at the workspace root. */
export const SHARED_UI_DIR = "_ui";

const EXTS = [".yaml", ".yml"];

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

/** The library folder for a project, or null when the workspace has none. */
export function uiLibraryDir(dir: string): string | null {
  const abs = join(dir, SHARED_UI_PATH);
  return existsSync(abs) && statSync(abs).isDirectory() ? abs : null;
}

/**
 * Where a ref files itself inside `_ui`, mirroring `_modules`.
 *
 * The namespace is dropped: `@engine/audio/delay/tape-delay` and a project's own `audio/reverb` both file under
 * their type folder, which is what makes the tree recognisable. Two refs CAN want the same path — a shared and
 * a local module of the same name — so writers step past an occupied file rather than clobber it, and readers
 * key on the `ref:` inside. An io module's ref carries no type (`desk`), so it gets one back here.
 */
export function uiPathFor(ref: string): string {
  const bare = ref.startsWith("@") ? ref.split("/").slice(1).join("/") : ref;
  const withType = bare.includes("/") ? bare : `io/${bare}`;
  return `${withType}.yaml`;
}

/** Read every panel in the workspace's `_ui`, keyed by the ref each one declares. */
export function loadUiLibrary(dir: string): UiLibrary {
  const out: UiLibrary = { byRef: {}, issues: [] };
  const root = uiLibraryDir(dir);
  if (!root) return out;

  const walk = (abs: string, rel: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      return; // unreadable folder — the rest of the library still loads
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const child = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      if (statSync(child).isDirectory()) {
        walk(child, childRel);
        continue;
      }
      if (!EXTS.includes(extname(name).toLowerCase())) continue;
      const parsed = parseUiFile(readFileSync(child, "utf8"));
      if (!parsed.value) {
        out.issues.push(
          `${SHARED_UI_DIR}/${childRel}: ${parsed.issues[0]?.message ?? "unreadable"}`,
        );
        continue;
      }
      const { ref, ...ui } = parsed.value;
      // First file wins, and the loser is reported: two panels for one module is a mistake with a silent
      // failure mode (whichever the filesystem lists first would quietly become the truth).
      if (out.byRef[ref]) {
        out.issues.push(
          `${SHARED_UI_DIR}/${childRel}: '${ref}' already has a panel (${basename(out.byRef[ref].path)})`,
        );
        continue;
      }
      out.byRef[ref] = { ref, ui, path: child };
    }
  };
  walk(root, "");
  return out;
}

/** Serialise a panel as a UI file — `ref` first, so the file says what it draws before it says how. */
export function uiFileText(ref: string, ui: ModuleUI, header?: string): string {
  const doc = { ref, ...ui };
  // Validated on the way out as well as in: a panel this can't read back is a file the editor would refuse.
  UiFileSchema.parse(doc);
  const body = stringifyUi(doc);
  return header ? `# ${header}\n${body}` : body;
}

/**
 * Write a panel into the library, returning the absolute path it landed in.
 *
 * A ref already in the library keeps its file, wherever the author moved it to. A new ref takes its mirrored
 * path, stepping past a file another ref already holds.
 */
export function writeUiFile(
  dir: string,
  ref: string,
  ui: ModuleUI,
  header?: string,
): string {
  const root = join(dir, SHARED_UI_PATH);
  const existing = loadUiLibrary(dir).byRef[ref];
  let path = existing?.path;
  if (!path) {
    const rel = uiPathFor(ref);
    path = join(root, rel);
    const stem = path.slice(0, -extname(path).length);
    for (let n = 2; existsSync(path); n++) path = `${stem}-${n}.yaml`;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, uiFileText(ref, ui, header), "utf8");
  return path;
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
  ref: string;
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
    `ref: ${JSON.stringify(doc.ref)}`,
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
