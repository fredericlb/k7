// identities.ts — which OIDC subject an email belongs to. One small JSON on the library
// volume, written whenever a session passes through, read by the one route a SERVICE calls on
// a person's behalf. See ../../../docs/media/sshKeyForService.md for why this bridge has to exist.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mediatekDir } from "@studio/mediatek/layout";

/** Where this directory lives; a dot-directory, so no family scan ever walks it. */
function projectsDir(): string {
  return process.env.STUDIO_PROJECTS_DIR || join(mediatekDir(), ".projects");
}

/** Case-insensitive: an IdP may hand back `Fred@…` today and `fred@…` tomorrow. */
const key = (email: string): string => email.trim().toLowerCase();

const indexPath = (): string => join(projectsDir(), "identities.json");

/** Pairs already on disk, keyed by the FILE — a volume can move under a test. Memory only. */
const recorded = new Set<string>();

function read(): Record<string, string> {
  try {
    const v = JSON.parse(readFileSync(indexPath(), "utf8")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {}; // absent, or half-written — an empty index is a real state, not a fault
  }
}

/** Idempotent and silent on failure — a read-only volume costs the bridge, never the request. */
export function rememberIdentity(sub: string, email: string | null): void {
  if (!email || !sub || key(email) === sub.toLowerCase()) return;
  // `/revision` is POLLED, so the common case must not read a file at all.
  const pair = `${indexPath()} ${key(email)} ${sub}`;
  if (recorded.has(pair)) return;
  try {
    const index = read();
    if (index[key(email)] === sub) return void recorded.add(pair);
    index[key(email)] = sub;
    mkdirSync(projectsDir(), { recursive: true });
    writeFileSync(indexPath(), `${JSON.stringify(index, null, 2)}\n`, "utf8");
    recorded.add(pair);
  } catch {
    /* the bridge is best-effort; subForEmail simply falls through to the identifier given */
  }
}

/** The subject behind an identifier, or the identifier itself — the fallback is not a guess. */
export function subFor(identifier: string): string {
  return read()[key(identifier)] ?? identifier;
}
