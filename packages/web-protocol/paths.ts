// paths.ts — the LEXICAL path checks every confinement in this tree is built on: is a path inside a
// root, does a relative path climb out, is a segment a plain name. Strings only, no `node:`, so a
// browser may have them. A link on disk can still lead out: the realpath half is song's `confineTo`.
// See docs/paths.md.

/** A root spelt the Windows way — a drive letter or a UNC share — where both separators count and case does not. */
const isWindowsPath = (p: string): boolean => /^(?:[A-Za-z]:|\\\\)/.test(p);

/** Whether `path` is `root` itself or below it; both absolute and already resolved, with the separator honoured. */
export function isWithin(root: string, path: string): boolean {
  if (!root || !path) return false;
  const win = isWindowsPath(root);
  const r = win ? root.toLowerCase() : root;
  const p = win ? path.toLowerCase() : path;
  if (p === r) return true;
  const seps = win ? ["\\", "/"] : ["/"];
  return seps.some((s) => p.startsWith(r.endsWith(s) ? r : r + s));
}

/** Whether `path` is strictly below `root` — `isWithin`, the root itself refused. */
export const isBelow = (root: string, path: string): boolean =>
  isWithin(root, path) && !isWithin(path, root);

/** Whether a `path.relative(root, x)` result leaves `root`: `..` first, or another drive's absolute path. */
export function climbsOut(rel: string): boolean {
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\"))
    return true;
  return rel.startsWith("/") || isWindowsPath(rel);
}

/** `.` or `..` — a segment that names no child, whatever the separator around it. */
export const isDotSegment = (seg: string): boolean =>
  seg === "." || seg === "..";

/** One segment that names a child of its folder: not empty, not `.`, not `..`. */
export const isPlainSegment = (seg: string): boolean =>
  seg !== "" && !isDotSegment(seg);

/** `path` split on `sep`, or null when any segment is empty, `.` or `..`. */
export function plainSegments(
  path: string,
  sep: string | RegExp = "/",
): string[] | null {
  const segs = path.split(sep);
  return segs.every(isPlainSegment) ? segs : null;
}

/** `plainSegments`, or a throw naming the path refused. */
export function assertPlainSegments(
  path: string,
  sep: string | RegExp = "/",
): string[] {
  const segs = plainSegments(path, sep);
  if (!segs) throw new Error(`refusing the path ${path}`);
  return segs;
}
