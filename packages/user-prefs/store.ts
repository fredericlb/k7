// store.ts — one small JSON per user on a volume, keyed by the OIDC subject. What a hosted
// service remembers ABOUT a person rather than about their files: which engine they drive,
// and whatever else earns a line later. See docs/store.md for why this is a file and not a
// database, and for what losing the volume costs.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "@studio/song/atomicWrite";

export interface PrefsStore<T> {
  /** This user's preferences, or null when they have never saved any. */
  read(sub: string): T | null;
  /** The same, for a caller about to MERGE: absent is null, and a file that cannot be read throws — see docs/store.md. */
  readForUpdate(sub: string): T | null;
  /** Replace them wholesale. Never throws; answers whether it landed — see docs/store.md. */
  write(sub: string, value: T): boolean;
}

/** The filename for a subject: a readable slug AND a hash, neither being safe alone — docs/store.md. */
export function fileFor(sub: string): string {
  const slug = sub.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
  const hash = createHash("sha256").update(sub).digest("hex").slice(0, 12);
  return `${slug}-${hash}.json`;
}

/** A store rooted at `dir`, created on first write, whose reads never throw — see docs/store.md. */
export function prefsStore<T>(dir: string): PrefsStore<T> {
  const readForUpdate = (sub: string): T | null => {
    let text: string;
    try {
      text = readFileSync(join(dir, fileFor(sub)), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    return JSON.parse(text) as T;
  };
  return {
    read(sub) {
      try {
        return readForUpdate(sub);
      } catch {
        return null;
      }
    },
    readForUpdate,
    write(sub, value) {
      try {
        mkdirSync(dir, { recursive: true });
        const file = join(dir, fileFor(sub));
        // Beside then renamed: a crash mid-write would leave a file that reads as "no preferences" (docs/store.md).
        writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
        return true;
      } catch {
        // Never throws — the choice stands for the session either way; the caller decides what to say (docs/store.md).
        return false;
      }
    },
  };
}
