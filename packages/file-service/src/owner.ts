// owner.ts — the ONE account this file service's workspaces belong to. The hub runs one process
// per account; the first account to reach it is recorded on disk, and no other ever passes, so a
// mistake upstream fails closed rather than handing one account's workspaces to another. Recorded
// beside the root, never in it, since an absent root is what seeds a new account's Examples.
// See docs/owner.md.

import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { studioDir } from "@studio/engine-client/paths";
import type { RequestHandler } from "express";
import { noteOwner } from "./engineLink.ts";

/** `<state>/owner.json` — `{ "owner": "<email>" }`. */
export function ownerPath(): string {
  return join(studioDir(), "owner.json");
}

/** The recorded owner, or null when no account has claimed this root yet. */
export function rootOwner(): string | null {
  try {
    const v = JSON.parse(readFileSync(ownerPath(), "utf8"));
    return typeof v.owner === "string" && v.owner ? v.owner : null;
  } catch {
    return null;
  }
}

/** Claim the root for `email`, or say whether it already is theirs; exclusive-create, so two first callers cannot both win. */
export function claimRoot(email: string): boolean {
  const owner = rootOwner();
  if (owner) return owner === email;
  try {
    const fd = openSync(ownerPath(), "wx");
    try {
      writeSync(fd, `${JSON.stringify({ owner: email }, null, 2)}\n`);
    } finally {
      closeSync(fd);
    }
    console.log(`   workspaces now belong to ${email}`);
    return true;
  } catch {
    // Lost the race, or the state dir is unwritable: whoever the record names now decides.
    return rootOwner() === email;
  }
}

/** A hosted root's gate: its one account passes, every other is refused. */
export const requireRootOwner: RequestHandler = (req, res, next) => {
  const email = req.userEmail ?? "";
  if (!email || !claimRoot(email)) {
    res.status(403).json({
      error: "these workspaces belong to another account",
    });
    return;
  }
  // The engine session follows the OWNER, never whoever asked last.
  noteOwner(email);
  next();
};

/** What stands in front of every workspace- and account-shaped route. */
export const workspaceGate: RequestHandler = requireRootOwner;

/** At boot: the session is the recorded owner's before any request names anyone. */
export function adoptRecordedOwner(): void {
  const owner = rootOwner();
  if (owner) noteOwner(owner);
}
