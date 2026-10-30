// fileBase.ts — the check behind a `PUT /file` that names its base: the fingerprint of the text the
// buffer was edited from, refused with a 409 when the file on disk no longer holds it. A write that
// names none is written as it always was. See docs/fileRoutes.md.

import { textHash } from "@studio/web-protocol/text-hash";

/** Thrown inside the journalled write, so a refused one records nothing; answered 409. */
export class StaleBase extends Error {
  readonly stale = true;
}

/** Refuse a write whose base is not what `read` finds on disk; a missing file, or one already holding `content`, is no conflict. */
export function assertBase(
  read: () => string | null,
  path: string,
  base: string | undefined,
  content: string,
): void {
  if (base === undefined) return;
  const now = read();
  // Already there: the retry of a write whose answer was lost (a timeout) is not a conflict with itself.
  if (now === null || now === content || textHash(now) === base) return;
  throw new StaleBase(
    `${path} changed on disk since it was opened — not overwritten`,
  );
}

/** The on-disk text of a workspace file, or null when there is none. */
export function diskText(read: () => { content: string }): string | null {
  try {
    return read().content;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
