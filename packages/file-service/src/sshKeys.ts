// sshKeys.ts — per-user SSH keys for cloning git workspaces, one keypair per user slug
// under ~/.lanes/ssh/<slug>/. They live on the ENGINE's machine because the clone
// runs here. The user pastes the PUBLIC half into their git host; the private half
// never leaves this machine and no route serves it.

import { execFile } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { sshDir } from "@lanes/engine-client/paths";
import { slugify } from "./slug.ts";

const run = promisify(execFile);

function keyPath(slug: string): string {
  return join(sshDir(slug), "id_ed25519");
}

/** The user's public key, or null if none was generated yet. */
export function publicKey(userEmail: string): string | null {
  try {
    return readFileSync(keyPath(slugify(userEmail)) + ".pub", "utf8").trim();
  } catch {
    return null;
  }
}

/** Generate the user's keypair if absent (idempotent) and return the public key. */
export async function generateKey(userEmail: string): Promise<string> {
  const existing = publicKey(userEmail);
  if (existing) return existing;
  const slug = slugify(userEmail);
  mkdirSync(sshDir(slug), { recursive: true });
  // -N "" = no passphrase: the clone runs unattended. ssh-keygen sets the 600 mode ssh insists on.
  await run("ssh-keygen", [
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    `lanes-${slug}`,
    "-f",
    keyPath(slug),
  ]);
  const pub = publicKey(userEmail);
  if (!pub) throw new Error("ssh-keygen reported success but wrote no key");
  return pub;
}

/** The GIT_SSH_COMMAND that pins git to this user's key. */
export function sshCommand(userEmail: string): string {
  const slug = slugify(userEmail);
  // IdentitiesOnly stops an agent offering the human's keys, BatchMode fails instead of prompting, and accept-new
  // pins the host key into OUR known_hosts. git splits this sh-style even on Windows, hence the forward slashes.
  const key = keyPath(slug).replaceAll("\\", "/");
  const hosts = join(sshDir(slug), "known_hosts").replaceAll("\\", "/");
  return (
    `ssh -i "${key}" -o IdentitiesOnly=yes -o BatchMode=yes ` +
    `-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${hosts}"`
  );
}
