// deviceIdentity.ts — who a device token names, as the rest of the server needs it: the account's email, which the
// token cannot carry since its slug is one-way, and the person who paired. Read by the engine registry's owner check
// and by the device door a paired machine browses this server through (apps/k7/backend/docs/serverPicker.md).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeviceTokens } from "./deviceTokens.ts";

/** The email of the account a device token was minted for, or null. */
export function deviceEmail(
  devices: DeviceTokens,
  accountDir: (slug: string) => string,
  token: string,
): string | null {
  const slug = devices.verify(token)?.slug;
  if (!slug) return null;
  // The account's file service recorded its email on its first start.
  try {
    const file = join(accountDir(slug), "owner.json");
    const owner = JSON.parse(readFileSync(file, "utf8")).owner;
    return typeof owner === "string" && owner ? owner : null;
  } catch {
    return null;
  }
}

/** The account's email and the person who paired, or null when the token names either nobody or no person. */
export function deviceUser(
  devices: DeviceTokens,
  accountDir: (slug: string) => string,
  token: string,
): { email: string; person: string } | null {
  const person = devices.verify(token)?.person;
  const email = deviceEmail(devices, accountDir, token);
  return person && email ? { email, person } : null;
}
