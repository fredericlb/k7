// identities.ts — which OIDC subject an email belongs to. One small JSON on the library
// volume, written whenever a session passes through, read by the one route a SERVICE calls on
// a person's behalf. See ../../docs/sshKeyForService.md for why this bridge has to exist.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectsDir } from "./store.ts";

/** Emails are matched case-insensitively: an IdP is free to hand back `Fred@…` today and
 *  `fred@…` tomorrow, and a key that stopped being found over a capital would be baffling. */
const key = (email: string): string => email.trim().toLowerCase();

const indexPath = (): string => join(projectsDir(), "identities.json");

/** Pairs this process has already put on disk, keyed by the FILE they went into — the volume
 *  can move under a test, and a memo that outlived it would skip the write that test needs.
 *  Memory only, and never read from: it saves a file read on a polled route, and a restart
 *  simply re-does one write. */
const recorded = new Set<string>();

function read(): Record<string, string> {
  try {
    const v = JSON.parse(readFileSync(indexPath(), "utf8")) as unknown;
    return v && typeof v === "object" ? (v as Record<string, string>) : {};
  } catch {
    return {}; // absent, or half-written — an empty index is a real state, not a fault
  }
}

/**
 * Record that this email is this subject. Idempotent, and silent on failure: a read-only
 * volume must cost the bridge, never the request that happened to be passing.
 *
 * Called from the session path rather than on login, because there is no login hook here —
 * pl8 verifies a cookie minted elsewhere. Any authenticated projects request will do: a person
 * whose key we are asked for has necessarily used this section to add the repository.
 */
export function rememberIdentity(sub: string, email: string | null): void {
  if (!email || !sub || key(email) === sub.toLowerCase()) return;
  // `/revision` is POLLED, so the common case must not read a file at all — this pair was
  // written by an earlier request of this process, and nothing else writes the index.
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

/**
 * The subject behind an identifier, or the identifier itself when there is nothing to look up.
 *
 * The fallback is not a guess: where the IdP hands back no email, `subOf` already uses the sub
 * for both, so the two spellings are one string and the index is empty by construction.
 */
export function subFor(identifier: string): string {
  return read()[key(identifier)] ?? identifier;
}
