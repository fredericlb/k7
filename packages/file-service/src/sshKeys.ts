// sshKeys.ts — the deploy key this machine clones with. It is NOT made here any more: st0
// owns the studio's git identity and this fetches a copy over the channel the two services
// already share (MEDIATEK_URL + MEDIATEK_TOKEN). One key per person, one to register with a
// git host. Why the private half is allowed to travel: packages/git-repos/docs/keys.md.

import { sshDir } from "@studio/engine-client/paths";
import {
  hasKey,
  installKey,
  sshCommand as sshCommandFor,
} from "@studio/git-repos/keys";
import { mediatekBase, mediatekToken } from "./mediatekLink.ts";
import { slugify } from "./slug.ts";

/** Where this machine keeps its copy — unchanged, so an existing key is still found. */
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
 * Make sure this user's key is on disk, fetching it from st0 if it is not.
 *
 * Idempotent and cheap once the key is there — the common case does no network at all. A
 * fetch failure is reported with the library's own words where it has any, because "no key
 * yet" and "the hosted library is down" need opposite fixes from the person reading it.
 */
export async function ensureKey(userEmail: string): Promise<void> {
  const dir = dirFor(userEmail);
  if (hasKey(dir)) return;
  const base = mediatekBase();
  if (!base)
    throw new NoKeyError(
      "no SSH key on this machine and no hosted library configured (MEDIATEK_URL) to ask for one",
    );
  const token = mediatekToken();
  if (!token)
    throw new NoKeyError(
      "no SSH key on this machine, and no API token (MEDIATEK_TOKEN) to fetch one with — paste a token into this machine's settings",
    );
  // Named, because the token a machine holds is a SERVICE's and has no key of its own. The
  // email is what this service knows a person by; st0 files them under their OIDC subject and
  // bridges the two. See apps/st0/docs/sshKeyForService.md.
  const res = await fetch(
    `${base.replace(/\/+$/, "")}/api/projects/ssh-key/private?user=${encodeURIComponent(userEmail)}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const said = await res
      .json()
      .then((b) => (b as { error?: string }).error)
      .catch(() => null);
    throw new NoKeyError(
      said || `could not fetch the SSH key: ${res.status} ${res.statusText}`,
    );
  }
  const body = (await res.json()) as {
    privateKey?: string;
    publicKey?: string | null;
  };
  if (!body.privateKey) throw new NoKeyError("the library returned no key");
  await installKey(dir, body.privateKey, body.publicKey ?? undefined);
}

/** The GIT_SSH_COMMAND that pins git to this user's key. */
export function sshCommand(userEmail: string): string {
  return sshCommandFor(dirFor(userEmail));
}
