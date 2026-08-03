// store.ts — one small JSON per user on a volume, keyed by the OIDC subject. What a hosted
// service remembers ABOUT a person rather than about their files: which engine they drive,
// and whatever else earns a line later. See docs/store.md for why this is a file and not a
// database, and for what losing the volume costs.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface PrefsStore<T> {
  /** This user's preferences, or null when they have never saved any. */
  read(sub: string): T | null;
  /** Replace them wholesale. Silently a no-op if the volume is unwritable — see below. */
  write(sub: string, value: T): void;
}

/**
 * The filename for a subject.
 *
 * A readable slug AND a hash of the full subject, because neither alone is safe. An OIDC
 * `sub` is an opaque string the IdP chooses: it can contain `/`, `..`, characters Windows
 * forbids, or run past a filesystem's name limit — so it can never be a path segment as-is.
 * A pure hash would be safe but leaves a directory nobody can read; the slug puts the
 * recognisable part back without being what makes it unique.
 *
 * The hash is what carries UNIQUENESS. Two subjects slugging identically get different
 * files, which is the difference between "two users share a preference" and "they don't".
 *
 * No dot in the allowed set, which is not fussiness: allowing it lets `../../etc/passwd`
 * slug to `.._.._etc_passwd`. That is harmless here — the separators are gone, so there is
 * no traversal left — but "harmless because of a second rule" is the shape of the bug that
 * comes back when the second rule moves. A subject reads fine without dots.
 */
export function fileFor(sub: string): string {
  const slug = sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const hash = createHash("sha256").update(sub).digest("hex").slice(0, 12);
  return `${slug}-${hash}.json`;
}

/**
 * A store rooted at `dir`, created on first write.
 *
 * Reads never throw: an absent file, a truncated one, or a directory nobody mounted all
 * read as "this user has no preferences", which is a real state the caller already handles
 * (the first login). A hosted service must not 500 because a volume is missing.
 */
export function prefsStore<T>(dir: string): PrefsStore<T> {
  return {
    read(sub) {
      try {
        return JSON.parse(readFileSync(join(dir, fileFor(sub)), "utf8")) as T;
      } catch {
        return null;
      }
    },
    write(sub, value) {
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, fileFor(sub)),
          `${JSON.stringify(value, null, 2)}\n`,
          "utf8",
        );
      } catch {
        // Deliberately silent, and deliberately not an error to the browser: what is lost
        // is that the choice outlives this session. Failing the click would take the
        // choice away too, which is strictly worse.
      }
    },
  };
}
