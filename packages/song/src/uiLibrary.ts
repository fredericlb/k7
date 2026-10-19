// uiLibrary.ts — a module's panel: the `ui.k7x` that sits BESIDE its `module.k7x`, in the same folder. A file
// of its own, so the plugin scan can rewrite what a module IS without touching how it is DRAWN. The FOLDER says
// which module a panel belongs to; the file only says how it looks. Read across every module library the project
// can see, nearest first. Rationale: docs/uiLibrary.md.

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { stringify } from "@studio/k7x/print";
import {
  type ModuleUI,
  UiFileSchema,
  WIDGETS_SCRIPT,
} from "@studio/song-schema/yaml/moduleSchema";
import { parseUiData, parseUiFile } from "@studio/song-schema/yaml/uiFile";
import { eachLibrarySibling } from "./moduleSiblings";
import { moduleLibraryDirs, moduleNamespaceOf } from "./sharedFolders";
import { UI_BASE } from "./yaml/moduleIO";
import { wsWriteText } from "./yaml/workspaceDoc";
import { settledParse, settledText } from "./yaml/yamlCache";

/** The panel file a module folder holds. */
export const UI_FILE = `${UI_BASE}.k7x`;

export interface UiEntry {
  ref: string;
  ui: ModuleUI;
  /** Absolute path of the file it came from. */
  path: string;
  /** The `widgets.js` beside it, as TEXT: the browser runs it, this side never does. */
  script?: string;
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
    const parsed = settledParse(path, "ui", parseUiFile, parseUiData);
    if (!parsed.value) {
      out.issues.push(
        `${label}/${rel}: ${parsed.issues[0]?.message ?? "unreadable"}`,
      );
      return;
    }
    const script = readScriptBeside(path);
    out.byRef[ref] = {
      ref,
      // Cloned: the parse is shared by every later read of this file.
      ui: structuredClone(parsed.value),
      path,
      ...(script ? { script } : {}),
    };
  });
  return out;
}

/** The panel with its script riding on it, which is how every hop after this one carries it. */
export const uiWithScript = (e: UiEntry): ModuleUI & { script?: string } =>
  e.script ? { ...e.ui, script: e.script } : e.ui;

// A panel's script is a sibling like the panel itself: same folder, same precedence.
function readScriptBeside(uiPath: string): string | undefined {
  const at = join(dirname(uiPath), WIDGETS_SCRIPT);
  if (!existsSync(at)) return undefined;
  try {
    return settledText(at);
  } catch {
    return undefined; // unreadable is absent: the screen says so, and the panel still loads
  }
}

/** Serialise a panel as a `ui.k7x`, each widget on one line; its header NAMES the module, as a comment — docs/uiLibrary.md. */
export function uiFileText(ui: ModuleUI, header?: string): string {
  // Validated on the way out as well as in: a panel this can't read back is a file the editor would refuse.
  UiFileSchema.parse(ui);
  return stringify(ui, {
    header: header ? [header] : [],
    inline: (p) => p.length === 2 && p[0] === "widgets",
  });
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
  wsWriteText(path, uiFileText(ui, header ?? `panel for ${ref}`));
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
