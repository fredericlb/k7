// uiLibrary.ts — a module's panel, kept OUTSIDE the module. A `ui` folder sits beside every module library
// (`_ui` beside a workspace's `_modules`, `ui` beside the mediatek's `modules`) and mirrors its tree; each
// file is what a module's `ui:` block used to be, plus a `ref:` naming the module it draws. The ref is what's
// looked up — the path is filing. Read across every library, written only to the project's own; see
// sharedFolders.ts `uiLibraryDirs`. Rationale: docs/uiLibrary.md and docs/sharedFolders.md.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, sep } from "node:path";
import { SHARED_UI_DIR, SHARED_UI_PATH, uiLibraryDirs } from "./sharedFolders";
import { type ModuleUI, UiFileSchema } from "./yaml/moduleSchema";
import { parseUiFile } from "./yaml/uiFile";

// Re-exported so the existing importers keep resolving them; they are DEFINED in
// sharedFolders.ts, beside `_modules` and `_library`.
export { SHARED_UI_DIR, SHARED_UI_PATH, uiLibraryDirs };

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

/** The project's OWN library folder — where a panel is written — or null when there is none.
 *  Reading spans more than this (see uiLibraryDirs); writing never does. */
export function uiLibraryDir(dir: string): string | null {
  const abs = join(dir, SHARED_UI_PATH);
  return existsSync(abs) && statSync(abs).isDirectory() ? abs : null;
}

/** Is this panel file in a library the project may not write to — a shared one it only reads? */
function isReadOnlyPanel(dir: string, path: string): boolean {
  const own = uiLibraryDir(dir);
  return !own || !(path === own || path.startsWith(own + sep));
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

/**
 * Read every panel the project can see, keyed by the ref each one declares.
 *
 * More than one library now: the project's own `_ui`, then the `ui` folder beside each
 * library in `modules_from` — the mediatek's, typically. NEAREST WINS, so a project that
 * forked a shared module draws its own face rather than the one it was copied from.
 */
export function loadUiLibrary(dir: string): UiLibrary {
  const out: UiLibrary = { byRef: {}, issues: [] };
  // Which library each accepted panel came from. A ref found in TWO of them is precedence
  // working — the fork case — while two in ONE of them is still the mistake it always was.
  const from: Record<string, string> = {};

  for (const root of uiLibraryDirs(dir)) {
    const label = basename(root);
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
            `${label}/${childRel}: ${parsed.issues[0]?.message ?? "unreadable"}`,
          );
          continue;
        }
        const { ref, ...ui } = parsed.value;
        if (out.byRef[ref]) {
          // Silent only when the winner came from a NEARER library — that is the point of the order.
          if (from[ref] === root)
            out.issues.push(
              `${label}/${childRel}: '${ref}' already has a panel (${basename(out.byRef[ref].path)})`,
            );
          continue;
        }
        out.byRef[ref] = { ref, ui, path: child };
        from[ref] = root;
      }
    };
    walk(root, "");
  }
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
 * Write a panel into the project's OWN library, returning the absolute path it landed in.
 *
 * A ref already in that library keeps its file, wherever the author moved it to. A new ref takes its mirrored
 * path, stepping past a file another ref already holds.
 *
 * Reading spans every library the project can see; writing never does. A panel found in a
 * SHARED one — the mediatek's — is read-only, exactly like the module it draws, so editing
 * it lands a copy here rather than changing what every other project sees.
 */
export function writeUiFile(
  dir: string,
  ref: string,
  ui: ModuleUI,
  header?: string,
): string {
  const root = join(dir, SHARED_UI_PATH);
  const existing = loadUiLibrary(dir).byRef[ref];
  let path =
    existing && !isReadOnlyPanel(dir, existing.path)
      ? existing.path
      : undefined;
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
