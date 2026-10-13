// moduleMove.ts — moving a library module to another folder of the same library and type. A
// module's ref IS its path, so a move renames it: every `extends:` naming the old ref is repointed,
// or the songs that used it would draw a `?` and play nothing. What a reader gets wrong: only the
// roots handed in are repointed — another account's workspace keeps the old ref. See docs/moduleMove.md.

import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { ENGINES_DIR } from "@studio/song-schema/engines";
import { MODULE_TYPES } from "@studio/song-schema/moduleTypes";
import { moduleFileFor } from "./yaml/moduleIO";
import { wsExists, wsRead, wsWrite } from "./yaml/workspaceFile";

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
    return !rel || rel.startsWith("..") ? (rel ? null : []) : rel.split(sep);
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
  if (wsExists(dest))
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
  if (!rel || rel.startsWith("..")) return null;
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

/** A ref as it is written: quoted or bare, followed by a node (`:`), a port (`#`), nothing — or, `under`, more path. */
const refPattern = (ref: string, under: boolean): RegExp =>
  new RegExp(
    `${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=["'\\s:#,\\]}${under ? "/" : ""}]|$)`,
    "gm",
  );

/** Rewrite `from` to `to` in every YAML file under `roots`; the files changed, absolute. */
export function repointRefs(
  roots: readonly string[],
  from: string,
  to: string,
  /** Also every ref BELOW `from`: a renamed folder takes each module in it along. */
  under = false,
): string[] {
  const pattern = refPattern(from, under);
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
      else if (/\.(ya?ml|k7x)$/i.test(n)) {
        const text = wsRead(abs);
        const next = text.replace(pattern, to);
        if (next !== text) {
          wsWrite(abs, next);
          changed.push(abs);
        }
      }
    }
  };
  for (const r of new Set(roots)) walk(r);
  return changed;
}
