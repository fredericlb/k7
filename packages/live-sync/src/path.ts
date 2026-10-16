// path.ts — the one rule every workspace path on the wire obeys: relative, POSIX, and unable to climb out.
// An op's `file` comes from another replica, so whoever writes it treats it as untrusted. See ../docs/ops.md.

import { isPlainSegment } from "@studio/web-protocol/paths";

/** Why `file` cannot name a workspace file, or null when it can. */
export function syncPathError(file: unknown): string | null {
  if (typeof file !== "string" || file === "") return "empty path";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused.
  if (/[\u0000-\u001f\u007f]/.test(file)) return "control character";
  if (file.includes("\\")) return "backslash";
  if (/^[A-Za-z]:/.test(file)) return "drive letter";
  if (file.startsWith("/")) return "absolute path";
  for (const seg of file.split("/"))
    if (!isPlainSegment(seg)) return `'${seg}' segment`;
  return null;
}

/** True when `file` is a workspace-relative POSIX path that stays inside the workspace. */
export const isSyncPath = (file: unknown): file is string =>
  syncPathError(file) === null;

/** `file`, or a throw naming why it is refused. */
export function assertSyncPath(file: unknown): string {
  const why = syncPathError(file);
  if (why) throw new Error(`refused sync path ${JSON.stringify(file)}: ${why}`);
  return file as string;
}
