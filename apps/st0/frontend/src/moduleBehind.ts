// moduleBehind.ts — the module FILE behind an instance's `extends:`, from the buffer and the
// hints: the same resolution a ctrl-click on the extends value takes (ui-editor's entityLinks),
// restated so the popin can decide whether there is a module to show BESIDE the instance.
// Pure, because which files sit side by side is a decision worth pinning.

import { readScalarField } from "./projectPaths";

/** Enough of the hints to resolve: the "kind:name" path map and the root it is relative to. */
export interface PathHints {
  paths: Record<string, string>;
  projectRoot: string;
}

/**
 * The file behind `content`'s `extends:`, joined the way entityLinks joins one — or null: no
 * `extends`, a base with no file to edit (`@engine/…`, the `@studio/…` track bases — the paths
 * map simply has no entry), a ref the project cannot resolve, or the file itself. `base:` is
 * tried first because that is what an extends names; `module:` covers a node extending another
 * local module by its chain ref.
 */
export function moduleBehind(
  content: string,
  hints: PathHints,
  ownPath?: string | null,
): string | null {
  const ref = readScalarField(content, "extends");
  if (!ref) return null;
  const rel = hints.paths[`base:${ref}`] ?? hints.paths[`module:${ref}`];
  if (!rel) return null;
  const abs = [hints.projectRoot, ...rel.split("/")].filter(Boolean).join("/");
  // The instance and its module can be one file (a module extending a base that resolves back
  // to it through an alias): the same buffer twice is not a comparison, it is a mirror.
  return ownPath === abs || ownPath === rel ? null : abs;
}
