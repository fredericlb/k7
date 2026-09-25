// mediatekLink.ts — where pl8 is, and the bearer to call it with. The file hub that spawns this
// service hands both in its environment, minted for the one account this process serves; nothing
// else supplies them. See docs/mediatekLink.md.

/** pl8's base URL for this account's calls, or null when the hub gave none. */
export function mediatekBase(): string | null {
  return process.env.MEDIATEK_URL || null;
}

/** The bearer this service calls pl8 with, or null when the hub gave none. */
export function mediatekToken(): string | null {
  return process.env.MEDIATEK_TOKEN || null;
}
