// moduleMigrate.ts — move a project off the generated plugin catalogue.
//
// Before, a module extended one of 254 `@engine/…` wrappers holding two facts the engine's scan
// already knew. After, a use of an engine plugin is a NODE naming the plugin itself (loader.ts);
// only what someone AUTHORED still points at the library, under `@library`.
//
// One-shot and re-runnable: a project with no `@engine/…` left is reported as already migrated.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { GRAPH_FILE } from "@studio/song-schema/yaml/graphSchema";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { engineModules, engineRef } from "./engineCatalogue";
import { loadProjectRoot, MODULE_TYPES } from "./loader";
import { moduleFileFor, nodeFiles } from "./yaml/moduleIO";

/** The node a module used BARE becomes. Its chain step gains this suffix. */
export const DEFAULT_NODE = "default";

export interface ModuleMigration {
  changed: boolean;
  /** "audio/reverb: reverb -> reverb:default" — what the chains have to follow. */
  modules: string[];
  /** Chain steps renamed, `from -> to`. */
  steps: string[];
  notes: string[];
  errors: string[];
}

const empty = (): ModuleMigration => ({
  changed: false,
  modules: [],
  steps: [],
  notes: [],
  errors: [],
});

/** The workspace `_modules` root this project inherits, or null. */
function libraryRoot(dir: string): string | null {
  let from: string[] = [];
  try {
    const mf = loadProjectRoot(dir).project?.modules_from;
    if (Array.isArray(mf)) from = mf.map(String);
  } catch {
    return null;
  }
  for (const p of from) {
    const abs = join(dir, p);
    if (
      existsSync(join(abs, "config.yaml")) ||
      existsSync(join(abs, "config.yml"))
    )
      return abs;
  }
  return null;
}

/** What a catalogue entry IS: a bare plugin wrapper, or something authored that stays in the library. */
function classify(
  lib: string | null,
  target: string,
): { kind: "wrapper" | "library" | "missing"; doc?: Record<string, unknown> } {
  if (!lib) return { kind: "missing" };
  const file = moduleFileFor(join(lib, target), "", "module");
  if (!file) return { kind: "missing" };
  const doc = (parseYaml(readFileSync(file.path, "utf8"), { version: "1.2" }) ??
    {}) as Record<string, unknown>;
  const keys = Object.keys(doc);
  // A wrapper says ONLY which plugin to load; anything else is authored, and authored things stay.
  const wrapper = keys.length > 0 && keys.every((k) => k === "plugin");
  return { kind: wrapper ? "wrapper" : "library", doc };
}

/** Every module the chains name with no node suffix — the ones that need a name. */
function bareChainSteps(dir: string): Set<string> {
  const file = join(dir, GRAPH_FILE);
  const out = new Set<string>();
  if (!existsSync(file)) return out;
  const doc = (parseYaml(readFileSync(file, "utf8"), { version: "1.2" }) ??
    {}) as {
    tracks?: Record<string, string[]>;
    modules?: Record<string, string[]>;
  };
  const note = (n: string) => {
    if (n && !n.includes(":") && !n.startsWith("@")) out.add(n);
  };
  for (const section of [doc.tracks, doc.modules])
    for (const [node, dests] of Object.entries(section ?? {})) {
      if (section === doc.modules) note(node);
      for (const d of dests ?? []) note(d);
    }
  return out;
}

/** Merge the generic UNDER a node: the node wins per key, `params` per param. */
function under(
  generic: Record<string, unknown>,
  node: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...generic };
  for (const [k, v] of Object.entries(node)) if (v !== undefined) out[k] = v;
  const gp = generic.params as Record<string, number> | undefined;
  const ip = node.params as Record<string, number> | undefined;
  if (gp || ip) out.params = { ...(gp ?? {}), ...(ip ?? {}) };
  return out;
}

/** Rewrite one project's modules; a module used BARE gains a `default` node, hence the renames returned. */
export function migrateProjectModules(
  dir: string,
  catalogue: Record<
    string,
    ReturnType<typeof engineModules>[string]
  > = engineModules(),
): ModuleMigration {
  const out = empty();
  const modulesDir = join(dir, "modules");
  if (!existsSync(modulesDir)) return out;
  const lib = libraryRoot(dir);
  // The modules the chains name WITHOUT a node: those gain a name, and the chains follow.
  const bare = bareChainSteps(dir);

  for (const type of Object.keys(MODULE_TYPES)) {
    const typeDir = join(modulesDir, type);
    if (!existsSync(typeDir)) continue;
    for (const name of readdirSync(typeDir)) {
      const folder = join(typeDir, name);
      const generic = moduleFileFor(folder, "", "module");
      if (!generic) continue;
      const doc = (parseYaml(readFileSync(generic.path, "utf8"), {
        version: "1.2",
      }) ?? {}) as Record<string, unknown>;
      const ref = typeof doc.extends === "string" ? doc.extends : "";
      if (!ref.startsWith("@engine/")) continue; // already migrated, or a module of its own

      const target = ref.slice("@engine/".length);
      const { kind, doc: catDoc } = classify(lib, target);
      if (kind === "missing") {
        out.errors.push(
          `${type}/${name}: extends '${ref}', which the library does not hold — left alone`,
        );
        continue;
      }

      // What the nodes will carry instead of the `extends`.
      const { extends: _drop, ...rest } = doc;
      const base: Record<string, unknown> = { ...rest };
      if (kind === "wrapper") {
        // From the engine's own catalogue by preference: the wrapper's copy mislabelled every VST3 instrument.
        const slug = String((catDoc?.plugin as { name?: string })?.name ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
        const fromEngine = catalogue[engineRef(slug)]?.plugin;
        const plugin = fromEngine ?? (catDoc?.plugin as object | undefined);
        if (!plugin) {
          out.errors.push(
            `${type}/${name}: '${ref}' names no plugin — left alone`,
          );
          continue;
        }
        if (!fromEngine)
          out.notes.push(
            `${type}/${name}: '${ref}' is not in this machine's scan — kept the catalogue's own plugin line`,
          );
        base.plugin = plugin;
      } else {
        // Authored: it stays in the library, under the namespace that names it.
        base.extends = `@library/${target}`;
      }

      const existing = [...nodeFiles(folder, "")];
      for (const { node, file } of existing) {
        const own = (parseYaml(readFileSync(file.path, "utf8"), {
          version: "1.2",
        }) ?? {}) as Record<string, unknown>;
        write(file.path, under(base, own), `${name}:${node}`);
      }
      // A BARE step needs its own node whether or not others sit beside it, or the song loses its plugin.
      if (bare.has(name)) {
        const path = join(folder, `${DEFAULT_NODE}.yaml`);
        write(path, base, `${name}:${DEFAULT_NODE}`);
        out.steps.push(`${name} -> ${name}:${DEFAULT_NODE}`);
      } else if (!existing.length) {
        // Neither used bare nor instanced: keep it as one node so nothing is lost.
        write(
          join(folder, `${DEFAULT_NODE}.yaml`),
          base,
          `${name}:${DEFAULT_NODE}`,
        );
        out.notes.push(
          `${type}/${name}: no chain names it — kept as ${name}:${DEFAULT_NODE}`,
        );
      }
      rmSync(generic.path, { force: true });
      out.modules.push(
        `${type}/${name}: ${kind === "wrapper" ? "engine plugin" : `@library/${target}`}`,
      );
      out.changed = true;
    }
  }
  return out;
}

/** Write a node file: a header saying what it is, then the merged struct. */
function write(
  path: string,
  value: Record<string, unknown>,
  key: string,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const head = value.extends
    ? `# ${key}: one use of a module in the shared library.\n`
    : `# ${key}: one use of a plugin the engine provides.\n` +
      `# The plugin is named here, so this project says what it uses whatever this\n` +
      `# machine has scanned.\n`;
  writeFileSync(
    path,
    head + stringifyYaml(value, { version: "1.2", lineWidth: 0 }),
    "utf8",
  );
}

/** Everything about the library itself: the wrappers go, the authored modules stay, the namespace changes. */
export interface LibraryMigration {
  changed: boolean;
  removed: string[];
  kept: string[];
  errors: string[];
}

/** Purge the generated wrappers from `_modules` and rename its namespace to `library`. */
export function migrateLibrary(root: string): LibraryMigration {
  const out: LibraryMigration = {
    changed: false,
    removed: [],
    kept: [],
    errors: [],
  };
  if (!existsSync(root)) {
    out.errors.push(`${root}: not found`);
    return out;
  }
  const walk = (dir: string, rel: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const abs = join(dir, e.name);
      const at = rel ? `${rel}/${e.name}` : e.name;
      // DESCEND FIRST, judge after: a folder can be both a module and a category, and the child is authored.
      walk(abs, at);
      const file = moduleFileFor(abs, "", "module");
      if (!file) continue; // a category folder — nothing of its own to judge
      // What sits beside the module file — sub-MODULES do not count, having just answered for themselves.
      const others = readdirSync(abs, { withFileTypes: true }).filter(
        (f) =>
          f.name !== basename(file.path) &&
          (!f.isDirectory() || f.name.endsWith(".presets")),
      );
      const doc = (parseYaml(readFileSync(file.path, "utf8"), {
        version: "1.2",
      }) ?? {}) as Record<string, unknown>;
      const keys = Object.keys(doc);
      const wrapper =
        others.length === 0 &&
        keys.length > 0 &&
        keys.every((k) => k === "plugin");
      if (!wrapper) {
        out.kept.push(at);
        continue;
      }
      // Only the module file goes when a sub-module survives, so the folder stays a category.
      const children = readdirSync(abs).filter(
        (f) => f !== basename(file.path),
      );
      if (children.length) rmSync(file.path, { force: true });
      else rmSync(abs, { recursive: true, force: true });
      out.removed.push(at);
      out.changed = true;
    }
  };
  // io lives in the projects: IN and OUT come from the engine, and a channel belongs to a song.
  const io = join(root, "io");
  if (existsSync(io)) {
    rmSync(io, { recursive: true, force: true });
    out.removed.push("io");
    out.changed = true;
  }
  for (const type of Object.keys(MODULE_TYPES)) {
    const typeDir = join(root, type);
    if (existsSync(typeDir)) walk(typeDir, type);
  }
  // The namespace: what is left is what someone wrote, so it is a library, not the engine.
  const config = existsSync(join(root, "config.yaml"))
    ? join(root, "config.yaml")
    : join(root, "config.yml");
  if (existsSync(config)) {
    const text = readFileSync(config, "utf8");
    const next = text.replace(
      /^(namespace:\s*)["']?engine["']?\s*$/m,
      "$1library",
    );
    if (next !== text) {
      writeFileSync(config, next, "utf8");
      out.changed = true;
    }
  }
  return out;
}
