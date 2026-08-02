// moduleFork.ts — editing a module that isn't yours to edit. A `_modules` library is shared
// by every project beside it, so it is read-only; a save aimed at one copies the module into
// the project instead, `<track>_<leaf>_<n>`, and repoints every chain step that named it. A
// whole folder and not an instance, because an instance's `ui:` has no effect and a module
// resolves its jsdsp/preset/rack against its own folder. Rationale: docs/moduleFork.md.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { parse as parseYaml } from "yaml";
import { deriveChains } from "./chainsGraph";
import { loadProjectRoot, MODULE_TYPES, moduleRefOf } from "./loader";
import { loadUiLibrary, writeUiFile } from "./uiLibrary";
import { parseChains, renameNode } from "./yaml/chainsFile";
import { entityFileFor, moduleFileFor } from "./yaml/moduleIO";

export type ForkedModule = {
  /** The shared ref that was edited, e.g. "@engine/audio/delay/tape-delay". */
  ref: string;
  /** The local module the copy became — what the chains now name. */
  module: string;
  /** Project-relative path of the module file that holds the edit. */
  path: string;
  /** The chains repointed at the copy (empty when the project didn't play the module yet). */
  chains: string[];
};

/** A single path segment the module vocabulary accepts — see createModuleFile's own check. */
const clean = (s: string): string =>
  s.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "x";

const toPosix = (p: string): string => p.split(sep).join("/");

/** The shared roots this project inherits, absolute, each with the namespace its config declares. */
export function sharedRoots(dir: string): { root: string; ns: string }[] {
  let from: string[] = [];
  try {
    const mf = loadProjectRoot(dir).project?.modules_from;
    if (Array.isArray(mf)) from = mf.map(String);
  } catch {
    return [];
  }
  const out: { root: string; ns: string }[] = [];
  for (const p of from) {
    const root = isAbsolute(p) ? p : resolve(dir, p);
    const config = entityFileFor(root, "", "config");
    if (!config) continue;
    const ns = String(
      (
        parseYaml(readFileSync(config.path, "utf8"), { version: "1.2" }) as {
          namespace?: unknown;
        } | null
      )?.namespace ?? "",
    );
    if (ns) out.push({ root: resolve(root), ns });
  }
  return out;
}

/**
 * The ref a shared module file answers to, or null when the file isn't one.
 *
 * Mirrors readModuleTree's keying rather than guessing at it: `<type>/<leaf>` at the top level and
 * `<type>/<category>/<leaf>` one folder deeper (the loader's "a folder with no module file is a category"),
 * and nothing below that — so a path this returns a ref for is a path the loader will agree about.
 */
export function sharedModuleRef(
  dir: string,
  file: string,
): { ref: string; folder: string; leaf: string; type: string } | null {
  const abs = resolve(file);
  for (const { root, ns } of sharedRoots(dir)) {
    if (!abs.startsWith(root + sep)) continue;
    const segs = toPosix(relative(root, abs)).split("/");
    // [type, ...subs, filename] — at most one category folder between the type and the module.
    if (segs.length < 3 || segs.length > 4) return null;
    const [type, ...rest] = segs;
    if (!(type in MODULE_TYPES)) return null;
    const folder = dirname(abs);
    return {
      ref: `@${ns}/${type}/${rest.slice(0, -1).join("/")}`,
      folder,
      leaf: basename(folder),
      type,
    };
  }
  return null;
}

/**
 * Every chain that reaches `module`, by name — the tracks the edit is really about.
 *
 * `out` counts as well as `use`: a module several things feed is a chain of its own now, and a chain that only
 * ever names itself tells nobody anything. Its own chain is left out for exactly that reason.
 */
function chainsUsing(text: string, module: string): string[] {
  const chains = deriveChains(parseChains(text).value);
  return Object.entries(chains)
    .filter(
      ([name, c]) =>
        name !== module &&
        (c.use.some((s) => s.module === module) ||
          c.out.some((o) => o.to === module)),
    )
    .map(([name]) => name);
}

/**
 * Copy a shared module into this project, with `content` as its module file, and repoint the chains at it.
 *
 * Throws for anything that isn't a shared module's own module file — a sidecar forked on its own would land in
 * a folder no chain names, which is a silent no-op dressed up as a save.
 */
export function forkSharedModule(
  dir: string,
  file: string,
  content: string,
): ForkedModule {
  const found = sharedModuleRef(dir, file);
  if (!found)
    throw new Error(
      `${basename(file)}: the shared module library is read-only, and this file is not a module that can be copied into the project`,
    );
  const { ref, folder, leaf, type } = found;
  if (basename(file).replace(/\.[^.]+$/, "") !== "module")
    throw new Error(
      `${basename(file)}: the shared module library is read-only — edit ${leaf}'s module file to get a project copy of it`,
    );

  // Named after the chain that plays it, so a copy says whose it is. A module the project doesn't play yet has
  // no track to be named after — it still forks, or the edit would just be lost.
  const chainsFile = entityFileFor(dir, "", "chains");
  const chainsText = chainsFile ? readFileSync(chainsFile.path, "utf8") : "";
  const track = chainsText ? (chainsUsing(chainsText, ref)[0] ?? null) : null;
  const stem = track ? `${clean(track)}_${clean(leaf)}` : clean(leaf);
  const typeDir = join(dir, "modules", type);
  let module = `${stem}_1`;
  for (let n = 2; existsSync(join(typeDir, module)); n++)
    module = `${stem}_${n}`;
  const dest = join(typeDir, module);

  mkdirSync(typeDir, { recursive: true });
  cpSync(folder, dest, { recursive: true }); // sidecars included — a module is its folder
  const generic = moduleFileFor(dest, "", "module");
  writeFileSync(generic?.path ?? join(dest, "module.yaml"), content, "utf8");

  // The panel follows the copy. It lives in `_ui` keyed by REF (see uiLibrary.ts), and the copy's ref is a new
  // one — without this the fork would come up blank, which reads as the edit having destroyed the module's face.
  const panel = loadUiLibrary(dir).byRef[ref];
  const localRef = moduleRefOf(type, module); // the ref the LOADER will key the copy by, not the folder name
  if (panel)
    writeUiFile(
      dir,
      localRef,
      panel.ui,
      `panel for ${localRef} (copied from ${ref})`,
    );

  // Repointed AFTER the files exist: a chain naming a module with no file is what the compiler refuses to load.
  let chains: string[] = [];
  if (chainsFile) {
    const r = renameNode(chainsText, ref, module);
    if (r.text !== chainsText) writeFileSync(chainsFile.path, r.text, "utf8");
    // The chains as they now stand, so the report names what the copy plays in — not the
    // nodes that were rewired, which is a file-level detail nobody asked about.
    chains = chainsUsing(r.text, module);
  }

  return {
    ref,
    module,
    path: `modules/${type}/${module}/${basename(generic?.path ?? "module.yaml")}`,
    chains,
  };
}
