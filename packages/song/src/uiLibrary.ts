// uiLibrary.ts — a module's panel: the `ui.yaml` that sits BESIDE its `module.yaml`, in the same folder. A file
// of its own, so the plugin scan can rewrite what a module IS without touching how it is DRAWN. The FOLDER says
// which module a panel belongs to; the file only says how it looks. Read across every module library the project
// can see, nearest first. Rationale: docs/uiLibrary.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type ModuleUI,
  UiFileSchema,
} from "@studio/song-schema/yaml/moduleSchema";
import { parseUiFile } from "@studio/song-schema/yaml/uiFile";
import { eachLibrarySibling } from "./moduleSiblings";
import { moduleLibraryDirs, moduleNamespaceOf } from "./sharedFolders";
import { UI_BASE } from "./yaml/moduleIO";

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

/** Where a ref's panel sits inside its library — the namespace dropped, io rescued, docs/uiLibrary.md. */
export function uiPathFor(ref: string): string {
  const bare = ref.startsWith("@") ? ref.split("/").slice(1).join("/") : ref;
  const withType = bare.includes("/") ? bare : `io/${bare}`;
  return `${withType}/${UI_FILE}`;
}

/** Every panel the project can see, keyed by its module's ref — NEAREST WINS, see docs/uiLibrary.md. */
export function loadUiLibrary(dir: string): UiLibrary {
  const out: UiLibrary = { byRef: {}, issues: [] };
  eachLibrarySibling(dir, UI_BASE, ({ ref, path, rel }, label) => {
    if (out.byRef[ref]) return; // a nearer library already answered — that is precedence working
    const parsed = parseUiFile(readFileSync(path, "utf8"));
    if (!parsed.value) {
      out.issues.push(
        `${label}/${rel}: ${parsed.issues[0]?.message ?? "unreadable"}`,
      );
      return;
    }
    out.byRef[ref] = { ref, ui: parsed.value, path };
  });
  return out;
}

/** Serialise a panel as a `ui.yaml`; its header NAMES the module, as a comment — docs/uiLibrary.md. */
export function uiFileText(ui: ModuleUI, header?: string): string {
  // Validated on the way out as well as in: a panel this can't read back is a file the editor would refuse.
  UiFileSchema.parse(ui);
  const body = stringifyUi(ui);
  return header ? `# ${header}\n${body}` : body;
}

/** Write a panel into its module's folder, SHARED library included — see docs/uiLibrary.md. */
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

/** The library that holds `ref`, throwing rather than guessing — `@engine` has no answer, docs/uiLibrary.md. */
function moduleRootFor(dir: string, ref: string): string {
  if (!ref.startsWith("@"))
    throw new Error(
      `${ref}: a module ref is always namespaced now — bare names resolve nothing`,
    );
  const ns = ref.slice(1).split("/")[0];
  for (const root of moduleLibraryDirs(dir))
    if (moduleNamespaceOf(root) === ns) return root;
  throw new Error(
    `${ref}: no module library this project can see declares '@${ns}', so there is no folder to draw it in`,
  );
}

// --- serialisation ------------------------------------------------------------

/** Emit the panel as YAML, each widget on ONE flow line — hand-written, see docs/uiLibrary.md. */
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
    // `{}` and not a bare `widgets:`, which YAML reads back as NULL and the schema then refuses.
    ids.length ? "widgets:" : "widgets: {}",
  ];
  for (const [id, w] of ids)
    lines.push(
      `  ${/^[A-Za-z0-9_-]+$/.test(id) ? id : JSON.stringify(id)}: ${scalar(w)}`,
    );
  return `${lines.join("\n")}\n`;
}
