// sshKeys.ts — the deploy key this machine clones with. It is MADE here and never leaves:
// a repository belongs to the machine that holds the working copy, so the key that opens it
// does too. It was fetched from pl8 over MEDIATEK_TOKEN until pl8 stopped knowing about git
// at all — packages/git-repos/docs/keys.md has what that traded away.

import { sshDir } from "@studio/engine-client/paths";
import {
  generateKey,
  hasKey,
  publicKey as publicHalf,
  sshCommand as sshCommandFor,
} from "@studio/git-repos/keys";
import { slugify } from "./slug.ts";

/** Where this machine keeps it — unchanged, so a key fetched by the older build is still found. */
function dirFor(userEmail: string): string {
  return sshDir(slugify(userEmail));
}

export class NoKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoKeyError";
  }
}

/**
 * Make sure this user's key is on disk, MAKING it if it is not. Idempotent in `generateKey`,
 * so the common case touches nothing — and there is no network here at all any more.
 *
 * A fresh key opens nothing until its public half is registered with the git host, which is
 * why `publicKeyFor` exists and why the home page draws it: the first clone after a new key
 * fails with git's own "Permission denied (publickey)", and that sentence is the instruction.
 */
export async function ensureKey(userEmail: string): Promise<void> {
  const dir = dirFor(userEmail);
  if (hasKey(dir)) return;
  try {
    await generateKey(dir, `st0 ${userEmail}`);
  } catch (e) {
    // ssh-keygen absent is the one failure worth naming: everything else here is a disk error.
    throw new NoKeyError(
      `could not make an SSH key on this machine: ${(e as Error).message}`,
    );
  }
}

/** The public half to paste at a git host, or null before anything has needed one. */
export function publicKeyFor(userEmail: string): string | null {
  return publicHalf(dirFor(userEmail));
}

/** …and make one on purpose, for a screen that offers it before the first clone. */
export async function createKeyFor(userEmail: string): Promise<string> {
  return generateKey(dirFor(userEmail), `st0 ${userEmail}`);
}

/** The GIT_SSH_COMMAND that pins git to this user's key. */
export function sshCommand(userEmail: string): string {
  return sshCommandFor(dirFor(userEmail));
}
