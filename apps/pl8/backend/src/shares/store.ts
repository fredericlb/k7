// store.ts — the frozen snapshots one person has shared: one small JSON per OIDC subject listing
// them, and one directory of bytes each. No database, the same arrangement `../projects/store.ts`
// uses and for the same reasons. See ../../docs/shares.md.

import { createHash, randomBytes } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { mediatekDir } from "@studio/mediatek/layout";
import { fileFor } from "@studio/user-prefs";
import type { ShareSummary } from "@studio/web-protocol";

/** The WIRE's shape, since a row goes to the browser verbatim — one declaration, no drift. */
export type ShareRecord = ShareSummary;

/** A dot-directory, so `writablePath` refuses it and no family scan ever walks it. */
export function sharesDir(): string {
  return process.env.STUDIO_SHARES_DIR || join(mediatekDir(), ".shares");
}

/** One file per user, named exactly as their prefs and their repositories are. */
function listPath(sub: string): string {
  return join(sharesDir(), "index", fileFor(sub));
}

/** Keyed by the HASH of the token, never the token: a path segment reaches every access log. */
export function blobDir(key: string): string {
  return join(sharesDir(), "blobs", key);
}

/** A key is a sha256 in hex, and nothing else is. Checked BEFORE any join. */
export const isKey = (s: string): boolean => /^[0-9a-f]{64}$/.test(s);

/** A fresh secret, and the key it hashes to. 256 bits: the link is the whole of the protection. */
export function mintToken(): { token: string; key: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, key: keyOf(token) };
}

export const keyOf = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Bumped on every write — two writes inside one filesystem tick are otherwise invisible below. */
let mutations = 0;

/** Reads never throw: an absent file is "none yet", which is a real state and not a fault. */
export function listShares(sub: string): ShareRecord[] {
  try {
    const raw = JSON.parse(readFileSync(listPath(sub), "utf8")) as {
      shares?: ShareRecord[];
    };
    return Array.isArray(raw.shares) ? raw.shares : [];
  } catch {
    return [];
  }
}

/** Writes THROW: a 200 for an unfiled share is a public link this service cannot revoke. */
function save(sub: string, shares: ShareRecord[]): void {
  mkdirSync(join(sharesDir(), "index"), { recursive: true });
  writeFileSync(
    listPath(sub),
    `${JSON.stringify({ shares }, null, 2)}\n`,
    "utf8",
  );
  mutations++;
}

export function addShare(sub: string, rec: ShareRecord): void {
  save(sub, [rec, ...listShares(sub)]);
}

export function findShare(sub: string, key: string): ShareRecord | null {
  return listShares(sub).find((s) => s.key === key) ?? null;
}

/** Revoke: the BYTES go first, then the row is dated rather than removed — ../../docs/shares.md. */
export function revokeShare(sub: string, key: string): boolean {
  const shares = listShares(sub);
  const at = shares.findIndex((s) => s.key === key);
  if (at < 0) return false;
  rmSync(blobDir(key), { recursive: true, force: true });
  if (!shares[at].revokedAt)
    save(
      sub,
      shares.map((s, i) =>
        i === at ? { ...s, token: "", revokedAt: new Date().toISOString() } : s,
      ),
    );
  return true;
}

/** This user's change token, for the Projets poll — no second timer of its own. */
export function revision(sub: string): string {
  let stamp = 0;
  try {
    stamp = Math.floor(statSync(listPath(sub)).mtimeMs);
  } catch {
    /* no file yet — 0 is a fine token for "nothing" */
  }
  return `${mutations}:${stamp}:${listShares(sub).length}`;
}
