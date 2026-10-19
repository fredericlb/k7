// moduleMove.ts — moving a library module to another folder of the same library and type. A
// module's ref IS its path, so a move renames it: every `extends:` naming the old ref is repointed,
// or the songs that used it would draw a `?` and play nothing. What a reader gets wrong: only the
// roots handed in are repointed — another account's workspace keeps the old ref. See docs/moduleMove.md.

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { type K7Path, walk } from "@studio/k7x/ast";
import { K7Document } from "@studio/k7x/document";
import { isDocFile } from "@studio/song-schema/docExt";
import { ENGINES_DIR } from "@studio/song-schema/engines";
import { MODULE_TYPES } from "@studio/song-schema/moduleTypes";
import { climbsOut } from "@studio/web-protocol/paths";
import { moduleFileFor } from "./yaml/moduleIO";
import { wsText, wsWriteText } from "./yaml/workspaceDoc";

/** Where a move lands, and the two refs it trades — refused, with the reason, when it cannot be one. */
export interface ModuleMove {
  from: string;
  to: string;
  dest: string;
}

/** Folders a walk for refs never enters: history, the bin, dependencies, and a stale library clone. */
const SKIP = new Set([
  ".git",
  "node_modules",
  "_history",
  "_recycle_bin",
  "_libraries",
]);

/** The ref a library module answers to, `@<library>/<type>/[<category>/]<name>`. */
const refOf = (library: string, segs: string[]): string =>
  `@${library}/${segs.join("/")}`;

/** Plan the move of the module folder `moduleAbs` into `destAbs`, both inside `library`'s `modules/`. */
export function planModuleMove(
  library: { name: string; root: string },
  moduleAbs: string,
  destAbs: string,
): ModuleMove {
  const modules = join(library.root, "modules");
  const inside = (abs: string): string[] | null => {
    const rel = relative(modules, abs);
    return !rel || climbsOut(rel) ? (rel ? null : []) : rel.split(sep);
  };
  const from = inside(moduleAbs);
  const to = inside(destAbs);
  if (!from || from.length < 2 || !moduleFileFor(moduleAbs, "", "module"))
    throw new Error("only a module of a library's modules/ can be moved");
  if (from.includes(ENGINES_DIR))
    throw new Error("an engine moves with its module, not on its own");
  if (!to || to.length === 0)
    throw new Error(`drop it on a folder of ${library.name}'s modules/`);
  if (to[0] !== from[0])
    throw new Error(
      `a module stays in its type: this one is ${from[0]}/, not ${to[0]}/`,
    );
  if (!(to[0] in MODULE_TYPES))
    throw new Error(`${to[0]}/ is not a module type`);
  // A ref holds at most one category between the type and the name — the loader reads no deeper.
  if (to.length > 2)
    throw new Error(
      "a module sits in its type folder or one category below it",
    );
  if (to.includes(ENGINES_DIR) || moduleFileFor(destAbs, "", "module"))
    throw new Error("drop it on a folder, not inside another module");
  if (dirname(moduleAbs) === destAbs) throw new Error("it is already there");
  const name = basename(moduleAbs);
  const dest = join(destAbs, name);
  if (existsSync(dest))
    throw new Error(`there is already a ${name} in ${to.join("/")}/`);
  return {
    from: refOf(library.name, from),
    to: refOf(library.name, [...to, name]),
    dest,
  };
}

/** The ref a path inside a library's `modules/` stands for — a module's, or the prefix of every one below a folder. */
export function refAt(
  library: { name: string; root: string },
  abs: string,
): string | null {
  const rel = relative(join(library.root, "modules"), abs);
  if (!rel || climbsOut(rel)) return null;
  return refOf(library.name, rel.split(sep));
}

/** Refused, with the reason: an engine is picked by its folder's NAME, which no ref carries (docs/moduleMove.md). */
export function assertNotEngine(library: { root: string }, abs: string): void {
  const rel = relative(join(library.root, "modules"), abs);
  if (rel.split(sep).includes(ENGINES_DIR))
    throw new Error(
      "an engine is picked by its name (`engine: <name>` in every node using it), which renaming would strand — make a new engine instead",
    );
}

/** `s` repointed when it IS the ref, or the ref followed by a node (`:`), a port (`#`) or, `under`, more path; else null. */
function repointed(
  s: string,
  from: string,
  to: string,
  under: boolean,
): string | null {
  if (!s.startsWith(from)) return null;
  const next = s.charAt(from.length);
  const follows = next === "" || next === ":" || next === "#";
  return follows || (under && next === "/") ? to + s.slice(from.length) : null;
}

/** One document's refs repointed, every string value and map key that names `from`; whether anything changed. */
export function repointDocRefs(
  doc: K7Document,
  from: string,
  to: string,
  under = false,
): boolean {
  if (!doc.contents) return false;
  const values: [K7Path, string][] = [];
  const keys: [K7Path, string][] = [];
  walk(doc.contents, (node, path, entry) => {
    if (entry) {
      const key = repointed(entry.key, from, to, under);
      if (key !== null) keys.push([path, key]);
    }
    if (node.kind === "scalar" && typeof node.value === "string") {
      const value = repointed(node.value, from, to, under);
      if (value !== null) values.push([path, value]);
    }
  });
  for (const [path, value] of values) doc.setIn(path, value);
  // Deepest first, so a renamed key never moves a path still waiting to be renamed.
  keys.sort((a, b) => b[0].length - a[0].length);
  for (const [path, key] of keys)
    try {
      doc.renameKey(path, key);
    } catch {
      // The map already holds the new key: renaming would merge two entries, so this one is left.
    }
  return values.length + keys.length > 0;
}

/** Rewrite `from` to `to` in every workspace file under `roots`; the files changed, absolute. */
export function repointRefs(
  roots: readonly string[],
  from: string,
  to: string,
  /** Also every ref BELOW `from`: a renamed folder takes each module in it along. */
  under = false,
): string[] {
  const changed: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return; // unreadable: the rest of the tree is still walked
    }
    for (const n of names) {
      if (SKIP.has(n)) continue;
      const abs = join(dir, n);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(abs);
      else if (isDocFile(n)) {
        const doc = new K7Document(wsText(abs));
        // A file that does not read is left as it is: its author has a syntax error to fix first.
        if (repointDocRefs(doc, from, to, under)) {
          wsWriteText(abs, doc.toString());
          changed.push(abs);
        }
      }
    }
  };
  for (const r of new Set(roots)) walk(r);
  return changed;
}
