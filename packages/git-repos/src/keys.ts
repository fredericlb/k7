// keys.ts — the per-user deploy key a git remote knows this person by: generate it, read
// either half, install a half received from elsewhere, and build the `GIT_SSH_COMMAND` that
// pins git to it. The directory is a parameter because the two services that use this do not
// keep the key in the same place — pl8 owns it, the file service holds a copy. See docs/keys.md.

import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface KeyPaths {
  private: string;
  public: string;
  knownHosts: string;
}

/** Where the three files sit under a key directory. */
export function keyPaths(dir: string): KeyPaths {
  return {
    private: join(dir, "id_ed25519"),
    public: join(dir, "id_ed25519.pub"),
    knownHosts: join(dir, "known_hosts"),
  };
}

/** The public half, or null if there is no key here yet. */
export function publicKey(dir: string): string | null {
  try {
    return readFileSync(keyPaths(dir).public, "utf8").trim();
  } catch {
    return null;
  }
}

/** The private half, or null. Never log, cache or forward what this returns. */
export function privateKey(dir: string): string | null {
  try {
    return readFileSync(keyPaths(dir).private, "utf8");
  } catch {
    return null;
  }
}

/** Is there a usable key here? The PRIVATE half is what makes one usable. */
export function hasKey(dir: string): boolean {
  return existsSync(keyPaths(dir).private);
}

/** Generate the keypair if absent (idempotent) and return the public half. */
export async function generateKey(
  dir: string,
  comment: string,
): Promise<string> {
  const existing = publicKey(dir);
  if (existing && hasKey(dir)) return existing;
  mkdirSync(dir, { recursive: true });
  // -N "" = no passphrase: the clone runs unattended. ssh-keygen sets the 600 mode ssh insists on.
  await run("ssh-keygen", [
    "-t",
    "ed25519",
    "-N",
    "",
    "-C",
    comment,
    "-f",
    keyPaths(dir).private,
  ]);
  const pub = publicKey(dir);
  if (!pub) throw new Error("ssh-keygen reported success but wrote no key");
  return pub;
}

/**
 * Install a key generated elsewhere. The public half is optional because an OpenSSH-format
 * private key already carries it — `ssh -i` needs no `.pub` beside it — but writing it when
 * we have it keeps `publicKey()` answering here too.
 *
 * `restrict` is what makes ssh accept the file: it refuses a key others can read, and on
 * Windows that is an ACL question rather than a mode, which `chmod` cannot answer.
 */
export async function installKey(
  dir: string,
  privatePem: string,
  publicPem?: string,
): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const p = keyPaths(dir);
  writeFileSync(p.private, privatePem, { mode: 0o600 });
  if (publicPem) writeFileSync(p.public, `${publicPem.trim()}\n`, "utf8");
  await restrict(p.private);
}

/** Make the private key readable by its owner alone, on either platform. */
async function restrict(file: string): Promise<void> {
  try {
    chmodSync(file, 0o600);
  } catch {
    /* a filesystem with no modes — the ACL below is the one that matters there */
  }
  if (process.platform !== "win32") return;
  const who = process.env.USERNAME;
  if (!who) return;
  try {
    // Break inheritance first, or the parent's grants survive and ssh still refuses the key.
    await run("icacls", [file, "/inheritance:r", "/grant:r", `${who}:F`]);
  } catch {
    /* best effort — ssh's own error names the file if this was not enough */
  }
}

/** The GIT_SSH_COMMAND that pins git to this key. */
export function sshCommand(dir: string): string {
  const p = keyPaths(dir);
  // IdentitiesOnly stops an agent offering the human's keys, BatchMode fails instead of prompting, and accept-new
  // pins the host key into OUR known_hosts. git splits this sh-style even on Windows, hence the forward slashes.
  const key = p.private.replaceAll("\\", "/");
  const hosts = p.knownHosts.replaceAll("\\", "/");
  return (
    `ssh -i "${key}" -o IdentitiesOnly=yes -o BatchMode=yes ` +
    `-o StrictHostKeyChecking=accept-new -o UserKnownHostsFile="${hosts}"`
  );
}

/** The environment every git subprocess in this repo runs with. */
export function gitEnv(keyDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_SSH_COMMAND: sshCommand(keyDir),
    GIT_TERMINAL_PROMPT: "0", // fail rather than prompt (no terminal to answer)
    // Load-bearing, not hygiene: a personal `insteadOf` rewrite turns the SSH URI back to https, privilege and all.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
}
