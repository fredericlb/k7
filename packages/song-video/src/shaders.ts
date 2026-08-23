// shaders.ts — the GLSL a shader module carries: which shaders it offers (the dropdown's
// entries) and the source of one (what the compositor is handed). Walks the ANCESTRY like
// moduleAssetChoices, for the same reason — a thin local module extending a shared one has
// no shaders of its own. Full rationale: docs/shaders.md.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SHADER_FRAGMENT,
  SHADER_VERTEX,
  SHADERS_DIR,
} from "@studio/song-schema/moduleTypes";

// A cycle in `extends` is refused upstream; this is the backstop, so a bad file cannot hang a build.
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

/** Is this folder a shader — does it hold BOTH stages? A half-authored one is not offered. */
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

/** The module folders to look in, nearest first — off the ref map, so no walk per ancestor. */
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

/** Every shader `module` can be set to, nearest owner first — DISCOVERED, not declared; docs/shaders.md. */
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

/** Read one shader's two stages, or null when the name carries nothing — never a throw, docs/shaders.md. */
export function readShader(
  dir: string,
  module: ShaderOwner | undefined,
  refs: Readonly<Record<string, ShaderOwner>>,
  name: string,
): ShaderSource | null {
  // Refused before any path is built, since `../../` is how a module's containment is climbed out of.
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
