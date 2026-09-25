// owner.ts — who may reach the WORKSPACES this process serves. Only the server holds workspaces:
// a hosted process is one account's, recorded on disk so nothing but that account ever passes;
// an engine's machine is shared by every account that plays on it, holds none, and refuses the
// routes outright. Recorded beside the root, never in it, since an absent root is what seeds a
// new account's Examples. See docs/owner.md.

import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { studioDir } from "@studio/engine-client/paths";
import type { RequestHandler } from "express";
import { noteOwner } from "./engineLink.ts";
import { HOSTED } from "./hosted.ts";

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

/** An engine's machine holds no workspace: it plays copies of the server's, for whoever holds its claim. */
export const noWorkspacesHere: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: "workspaces live on the server — this is an engine's machine",
    hint: "the server hosts them when $STUDIO_FILES_ROOT is set (packages/file-hub/docs/fileHub.md)",
  });
};

/** What stands in front of every workspace- and account-shaped route, by where this process runs. */
export const workspaceGate: RequestHandler = HOSTED
  ? requireRootOwner
  : noWorkspacesHere;

/** At boot, hosted: the session is the recorded owner's before any request names anyone. */
export function adoptRecordedOwner(): void {
  const owner = rootOwner();
  if (owner) noteOwner(owner);
}
