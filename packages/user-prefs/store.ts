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

/** The filename for a subject: a readable slug AND a hash, neither being safe alone — docs/store.md. */
export function fileFor(sub: string): string {
  const slug = sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const hash = createHash("sha256").update(sub).digest("hex").slice(0, 12);
  return `${slug}-${hash}.json`;
}

/** A store rooted at `dir`, created on first write, whose reads never throw — see docs/store.md. */
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
        // Deliberately silent: failing the click would take the choice away too (docs/store.md).
      }
    },
  };
}
