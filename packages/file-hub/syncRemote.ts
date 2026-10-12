// syncRemote.ts — an account on THIS hub paired with a remote origin: its file service syncs with that
// origin's relay, with the device token the origin minted, instead of with this hub's own relay.
// Per account, because a desktop's hub also serves its local user, whose workspaces are not the account's.
// See docs/syncRelay.md.

import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** What a pairing holds: the remote relay's socket URL, the device token, and the account's email. */
export interface SyncRemote {
  url: string;
  token: string;
  user: string;
}

const FILE = ".sync-remote.json";

/** The pairing of the account folder `home`, or null when it syncs with this hub's own relay. */
export function readRemote(home: string): SyncRemote | null {
  try {
    const v = JSON.parse(
      readFileSync(join(home, FILE), "utf8"),
    ) as Partial<SyncRemote>;
    return v.url && v.token && v.user
      ? { url: v.url, token: v.token, user: v.user }
      : null;
  } catch {
    return null;
  }
}

export function writeRemote(home: string, remote: SyncRemote): void {
  writeFileSync(join(home, FILE), `${JSON.stringify(remote, null, 2)}\n`, {
    mode: 0o600,
  });
}

export function forgetRemote(home: string): boolean {
  const at = join(home, FILE);
  if (!existsSync(at)) return false;
  rmSync(at, { force: true });
  return true;
}

/** Every paired account under `dataRoot`: what the hub starts at once and never stops for idleness. */
export function pairedAccounts(dataRoot: string): SyncRemote[] {
  let names: string[] = [];
  try {
    names = readdirSync(dataRoot);
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const r = readRemote(join(dataRoot, n));
    return r ? [r] : [];
  });
}
