// controller.ts — a module's MIDI map: the `controller.yaml` beside its `module.yaml`, saying which
// CC moves which param. A fourth sibling of the generic, the panel and the preset shelf, and for the
// same reason as the panel: the FOLDER says which module it belongs to, the file only says how it is
// played. Read across every module library the project can see. Rationale: docs/controller.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { parse as parseYaml } from "yaml";
import { eachLibrarySibling } from "./moduleSiblings";
import { CONTROLLER_BASE, moduleFileFor } from "./yaml/moduleIO";
import {
  type CcBinding,
  CcBindingSchema,
  type ControllerFile,
  ControllerFileSchema,
} from "./yaml/moduleSchema";

/** The map file a module folder holds, as it is written. `.yml` is read too (moduleFileFor probes both). */
export const CONTROLLER_FILE = `${CONTROLLER_BASE}.yaml`;

export interface ControllerEntry {
  ref: string;
  /** By the widget's `bind` string, verbatim — see setCcBinding. */
  cc: ControllerFile;
  /** Absolute path of the file it came from. */
  path: string;
}

export interface ControllerLibrary {
  byRef: Record<string, ControllerEntry>;
  /** Unreadable files, reported rather than thrown: one bad map must not hide the rest. */
  issues: string[];
}

/**
 * Read every MIDI map the project can see, keyed by the ref of the module whose folder each sits in.
 *
 * Nearest library wins, exactly as a panel does: a project that forked a shared module plays its own
 * copy rather than the one it was copied from.
 */
export function loadControllerLibrary(dir: string): ControllerLibrary {
  const out: ControllerLibrary = { byRef: {}, issues: [] };
  eachLibrarySibling(dir, CONTROLLER_BASE, ({ ref, path, rel }, label) => {
    if (out.byRef[ref]) return; // a nearer library already answered
    const parsed = parseController(readFileSync(path, "utf8"));
    if (!parsed.value) {
      out.issues.push(`${label}/${rel}: ${parsed.issue}`);
      return;
    }
    out.byRef[ref] = { ref, cc: parsed.value, path };
  });
  return out;
}

/** Parse one map. A file the schema refuses reads as an ISSUE, never a throw — one malformed map
 *  must not stop a module loading, exactly like a malformed panel. */
export function parseController(text: string): {
  value: ControllerFile | null;
  issue: string;
} {
  let raw: unknown;
  try {
    raw = parseYaml(text, { version: "1.2" });
  } catch (e) {
    return { value: null, issue: (e as Error).message };
  }
  const r = ControllerFileSchema.safeParse(raw ?? {});
  if (!r.success) {
    const i = r.error.issues[0];
    return {
      value: null,
      issue: `${i.path.map(String).join(".") || "(root)"}: ${i.message}`,
    };
  }
  return { value: r.data, issue: "" };
}

/**
 * The folder a module's own files live in, wherever that library is, or null.
 *
 * Found by looking for the `module.yaml` the ref answers to — the same walk the panels use, so a
 * folder this names is one the loader agrees about. A module the ENGINE merely reports has no folder
 * at all (see moduleFork's `module own`), and gets null.
 */
export function moduleFolderForRef(dir: string, ref: string): string | null {
  let hit: string | null = null;
  eachLibrarySibling(dir, "module", (found) => {
    if (hit || found.ref !== ref) return;
    hit = dirname(found.path);
  });
  return hit;
}

/** Where a ref's map sits — beside its `module.yaml`, in whichever library holds it. */
export function moduleControllerFile(dir: string, ref: string): string | null {
  const folder = moduleFolderForRef(dir, ref);
  return folder ? join(folder, CONTROLLER_FILE) : null;
}

/** The map a module declares, or an empty one. */
export function readModuleController(dir: string, ref: string): ControllerFile {
  const folder = moduleFolderForRef(dir, ref);
  if (!folder) return {};
  const found = moduleFileFor(folder, "", CONTROLLER_BASE);
  if (!found) return {};
  return parseController(readFileSync(found.path, "utf8")).value ?? {};
}

/**
 * Bind `param` to a CC, or unbind it with `null`. Returns the path written, project-relative.
 *
 * `param` is the widget's `bind` string VERBATIM — `Cutoff`, or `@monitor` for a module field — so the
 * map and the panel line up key for key and can be read side by side.
 *
 * Writes into the module's own folder, wherever it lives, which is the point of the location: the map
 * belongs to the module the way its panel does, and follows it into every project that names it. The
 * flip side, and it is worth knowing: every NODE of the module shares one map, exactly as they
 * share one preset shelf (presets.ts) and one panel.
 */
export function setCcBinding(
  dir: string,
  ref: string,
  param: string,
  binding: CcBinding | null,
): string {
  if (!param.trim()) throw new Error("a binding needs a parameter name");
  const folder = moduleFolderForRef(dir, ref);
  if (!folder)
    throw new Error(
      `module '${ref}' has no folder to hold a controller map — run \`module own ${ref}\` first`,
    );
  if (binding) CcBindingSchema.parse(binding);

  const existing = readModuleController(dir, ref);
  const next: ControllerFile = { ...existing };
  if (binding) next[param] = binding;
  else delete next[param];

  // An existing `.yml` is rewritten where it is; a new file is written as `.yaml`.
  const found = moduleFileFor(folder, "", CONTROLLER_BASE);
  const path = found?.path ?? join(folder, CONTROLLER_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, controllerFileText(ref, next), "utf8");
  return relative(dir, path);
}

// A key as YAML, quoted only when it has to be — the same rule the panel and preset writers apply. A
// param name is a plugin's own ("Filter Type", "Dry/Wet"), so it needs the escape hatch.
const key = (k: string): string =>
  /^[A-Za-z0-9_@][A-Za-z0-9 _.\-+@]*$/.test(k) &&
  !/^(y|n|yes|no|on|off|true|false|null)$/i.test(k)
    ? k
    : JSON.stringify(k);

/**
 * Serialise the map: one FLOW mapping per param, hand-written rather than through `stringify`.
 *
 * A binding is read as a row — a param and the two numbers that play it — and the block form turns six
 * bindings into eighteen lines nobody scans. Same argument, same shape, as the panel and preset writers.
 */
function controllerFileText(ref: string, map: ControllerFile): string {
  ControllerFileSchema.parse(map);
  const lines = [
    `# MIDI map for ${ref} — <param>: { ch, cc }. Shared by every node of this module.`,
  ];
  for (const [param, b] of Object.entries(map))
    lines.push(`${key(param)}: { ch: ${b.ch}, cc: ${b.cc} }`);
  return `${lines.join("\n")}\n`;
}
