// shaders.ts — the GLSL a shader module carries: which shaders it offers (the dropdown's
// entries) and the source of one (what the compositor is handed). Walks the ANCESTRY like
// moduleAssetChoices, for the same reason — a thin local module extending a shared one has
// no shaders of its own. Full rationale: docs/shaders.md.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { SHADER_FRAGMENT, SHADER_VERTEX, SHADERS_DIR } from "./moduleTypes";

// A cycle in `extends` is refused upstream; this is the backstop moduleAssetChoices has, so a
// bad file cannot hang a graph build.
const MAX_ANCESTRY = 16;

/** Just enough of a module to find its folder and its parent — the resolved map and the ref map both fit. */
interface ShaderOwner {
  category?: unknown;
  file?: unknown;
  extends?: unknown;
  /** Where its files are, stamped by the loader on every module it reads. */
  folderAbs?: unknown;
}

/** One shader, as the renderer receives it: a name and the two stages, already read. */
export interface ShaderSource {
  name: string;
  vertex: string;
  fragment: string;
}

/**
 * Is this folder a shader — does it hold both stages?
 *
 * Both, deliberately. A folder with only a fragment is half-authored, and offering it would
 * compile a program with no vertex stage and fail inside the compositor, where the message is
 * about GL rather than about a file somebody has not finished writing. It is simply not a shader
 * yet, so it is not offered.
 */
function isShaderFolder(abs: string): boolean {
  return (
    existsSync(join(abs, SHADER_VERTEX)) &&
    existsSync(join(abs, SHADER_FRAGMENT))
  );
}

/** The shader folders directly under one module folder's `shaders/`, sorted. */
function shadersIn(folderAbs: string): string[] {
  const root = join(folderAbs, SHADERS_DIR);
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return []; // no shaders/ folder is the ordinary case for every module that is not one
  }
  return entries.filter((n) => isShaderFolder(join(root, n))).sort();
}

/**
 * The module folders to look in, nearest first — this module's, then everything it extends.
 *
 * Read off the ref map the caller already loaded (`folderAbs`, stamped by the loader), so this
 * costs no directory walk per ancestor. That was the mistake `moduleAssetChoices` records having
 * made, and it turned one graph build into a walk per node.
 */
function ownerFolders(
  dir: string,
  module: ShaderOwner | undefined,
  refs: Readonly<Record<string, ShaderOwner>>,
): string[] {
  const out: string[] = [];
  const own =
    typeof module?.folderAbs === "string" && module.folderAbs
      ? module.folderAbs
      : module?.category && module?.file
        ? join(dir, "modules", String(module.category), String(module.file))
        : undefined;
  if (own) out.push(own);
  let ref = module?.extends;
  for (let i = 0; i < MAX_ANCESTRY && typeof ref === "string" && ref; i++) {
    const parent = refs[ref];
    if (typeof parent?.folderAbs === "string" && parent.folderAbs)
      out.push(parent.folderAbs);
    ref = parent?.extends;
  }
  return out;
}

/**
 * Every shader `module` can be set to, by name, nearest owner first.
 *
 * This is the dropdown's list, and it is discovered rather than declared — which is the whole
 * difference from an ordinary `dropdown`, whose entries its panel's author wrote down. A module
 * gains a shader by someone dropping a folder into it, and no file has to be edited to say so.
 *
 * A nearer module's shader shadows an inherited one of the same name, matching the precedence
 * `moduleAssetChoices` gives assets: the list you pick from and the source you get must agree.
 */
export function moduleShaderChoices(
  dir: string,
  module: ShaderOwner | undefined,
  refs: Readonly<Record<string, ShaderOwner>>,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const folder of ownerFolders(dir, module, refs))
    for (const name of shadersIn(folder))
      if (!seen.has(name)) {
        seen.add(name);
        out.push(name);
      }
  return out;
}

/**
 * Read one shader's two stages, or null when `name` names nothing this module carries.
 *
 * Null rather than a throw, and that is what keeps a project OPENABLE while a shader is missing:
 * a song committed with `shader: ripple` whose folder has not synced yet still loads, still
 * draws, and passes its picture through — the same posture `presetFor` takes to a base that has
 * gone missing. What is lost is an effect, and losing it loudly would lose the song.
 *
 * Searched in the same order the choices are offered, so the source that comes back is the one
 * the name meant.
 */
export function readShader(
  dir: string,
  module: ShaderOwner | undefined,
  refs: Readonly<Record<string, ShaderOwner>>,
  name: string,
): ShaderSource | null {
  // Refused before any path is built, not resolved and then checked: the value comes out of a
  // YAML file, and `../../` is exactly how a module's containment would be climbed out of. The
  // schema makes the same check on the way in; this is the read side of one rule.
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return null;
  for (const folder of ownerFolders(dir, module, refs)) {
    const abs = join(folder, SHADERS_DIR, name);
    if (!isShaderFolder(abs)) continue;
    try {
      return {
        name,
        vertex: readFileSync(join(abs, SHADER_VERTEX), "utf8"),
        fragment: readFileSync(join(abs, SHADER_FRAGMENT), "utf8"),
      };
    } catch {
      return null; // readable a moment ago, gone now — same answer as never having been there
    }
  }
  return null;
}
