// mediatekLink.ts — where the hosted médiathèque is, and the token to reach it. The supervisor
// passes both in the environment when IT spawns this service; nothing does in a checkout, where
// the dev session starts this service as a resource of its own. So each falls back to the file
// the supervisor itself reads. See docs/mediatekLink.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { settingsPath, webEndpointsDir } from "@studio/engine-client/paths";

/** One JSON file's `.url`, or null for anything that is not one — absent, unparseable, or
 *  half-written by a backend booting right now. */
function urlIn(path: string): string | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as { url?: unknown };
    return typeof v.url === "string" && v.url !== "" ? v.url : null;
  } catch {
    return null;
  }
}

/**
 * The hosted library, or null when this machine caches nothing — a working state, not a fault.
 *
 * The advertised file is read **by name**, not derived from whichever registry answered first.
 * Hosted, every service shares one origin at a fixed path, so either would do. In a checkout
 * they do not: each backend advertises its own loopback PORT, so "the origin of some registry"
 * is l8's 8789 as often as st0's 8795, and the médiathèque's routes are not there.
 */
export function mediatekBase(): string | null {
  return process.env.MEDIATEK_URL || urlIn(join(webEndpointsDir(), "st0.json"));
}

/**
 * The token this machine calls the médiathèque with, or null when it has none.
 *
 * `npm run tokens` writes it to the supervisor's settings and nowhere else, deliberately: the
 * credential belongs to a machine rather than to a deployment. The supervisor passes it down
 * when it spawns us; read from the same file, we do not need it to have.
 */
export function mediatekToken(): string | null {
  if (process.env.MEDIATEK_TOKEN) return process.env.MEDIATEK_TOKEN;
  try {
    const v = JSON.parse(readFileSync(settingsPath(), "utf8")) as {
      mediatekToken?: unknown;
    };
    return typeof v.mediatekToken === "string" && v.mediatekToken !== ""
      ? v.mediatekToken
      : null;
  } catch {
    return null;
  }
}
