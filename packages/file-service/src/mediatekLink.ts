// mediatekLink.ts — where the hosted médiathèque is, and the token to reach it. The supervisor
// passes both in the environment when IT spawns this service; nothing does in a checkout, where
// the dev session starts this service as a resource of its own. So each falls back to the file
// the supervisor itself reads. See docs/mediatekLink.md.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  existingSettingsPath,
  webEndpointsDir,
} from "@studio/engine-client/paths";

/** One JSON file's `.url`, or null when it is absent, unparseable, or half-written. */
function urlIn(path: string): string | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as { url?: unknown };
    return typeof v.url === "string" && v.url !== "" ? v.url : null;
  } catch {
    return null;
  }
}

/** The hosted library, read BY NAME rather than off any registry — see docs/mediatekLink.md. */
export function mediatekBase(): string | null {
  return process.env.MEDIATEK_URL || urlIn(join(webEndpointsDir(), "pl8.json"));
}

/** The token this machine calls the médiathèque with, read from the supervisor's own settings file. */
export function mediatekToken(): string | null {
  if (process.env.MEDIATEK_TOKEN) return process.env.MEDIATEK_TOKEN;
  try {
    const v = JSON.parse(readFileSync(existingSettingsPath(), "utf8")) as {
      mediatekToken?: unknown;
    };
    return typeof v.mediatekToken === "string" && v.mediatekToken !== ""
      ? v.mediatekToken
      : null;
  } catch {
    return null;
  }
}
