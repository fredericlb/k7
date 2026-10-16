// store.ts — the search history one person sees under the search field, kept on the library
// volume under a dot-directory so no family scan ever walks it. Same `<slug>-<hash>` naming as
// the preferences and the repositories. See ../../../docs/media/hunt.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { mediatekDir } from "@studio/mediatek/layout";
import { fileFor } from "@studio/user-prefs";
// The row's shape is the CONTRACT, so it lives where both halves read it.
import type { HuntRecord } from "@studio/web-protocol/hunt";

export type { HuntRecord };

/** A memory for recognising what you already asked, not an archive — and read whole on every poll. */
const KEEP = 100;

/** Under a dot-directory: `writablePath` refuses those and `revision.ts` does not walk them. */
export function huntsDir(): string {
  return process.env.STUDIO_HUNTS_DIR || join(mediatekDir(), ".hunts");
}

const pathFor = (sub: string): string => join(huntsDir(), fileFor(sub));

export function listHunts(sub: string): HuntRecord[] {
  try {
    const raw = JSON.parse(readFileSync(pathFor(sub), "utf8")) as {
      hunts?: HuntRecord[];
    };
    return Array.isArray(raw.hunts) ? raw.hunts : [];
  } catch {
    // No file yet is the ordinary case for somebody who has never searched.
    return [];
  }
}

function writeAll(sub: string, hunts: HuntRecord[]): void {
  const path = pathFor(sub);
  mkdirSync(dirname(path), { recursive: true });
  // Throws rather than swallowing: a lost row hides a download that really happened.
  writeFileSync(
    path,
    `${JSON.stringify({ hunts: hunts.slice(0, KEEP) }, null, 2)}\n`,
    "utf8",
  );
}

/** Newest first, which is the order the screen draws and therefore the order kept on disk. */
export function saveHunt(sub: string, rec: HuntRecord): void {
  const rest = listHunts(sub).filter((h) => h.id !== rec.id);
  writeAll(sub, [rec, ...rest]);
}

/** Change part of a row: rewrites the whole file, cheaper at a hundred rows than any index. */
export function patchHunt(
  sub: string,
  id: string,
  patch: Partial<HuntRecord>,
): HuntRecord | null {
  const all = listHunts(sub);
  const i = all.findIndex((h) => h.id === id);
  if (i < 0) return null;
  const next = { ...all[i], ...patch };
  all[i] = next;
  writeAll(sub, all);
  return next;
}

export function removeHunt(sub: string, id: string): boolean {
  const all = listHunts(sub);
  const kept = all.filter((h) => h.id !== id);
  if (kept.length === all.length) return false;
  writeAll(sub, kept);
  return true;
}

/** Rows a restart orphaned, told the truth about at the first read — ../../../docs/media/hunt.md. */
export function reconcile(sub: string, running: Set<string>): HuntRecord[] {
  const all = listHunts(sub);
  let changed = false;
  const out = all.map((h) => {
    if (h.status !== "searching" && h.status !== "downloading") return h;
    if (running.has(h.id)) return h;
    changed = true;
    return {
      ...h,
      status: "failed" as const,
      error: "interrompu par un redémarrage du service",
      endedAt: Date.now(),
    };
  });
  if (changed) writeAll(sub, out);
  return out;
}
