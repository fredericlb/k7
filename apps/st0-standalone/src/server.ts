// server.ts — the st0 server this machine syncs its signed-in account with, as the person chose it at
// sign-in: kept in the app's state folder, `https://st0.app` until they choose another. Sign-in itself
// still goes through the app's own provider (docs/signIn.md); this names where pairing goes (docs/sync.md).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeServer } from "@studio/web-protocol/pairing";
import { STUDIO_ORIGIN } from "@studio/web-protocol/services";
import { app } from "electron";

const file = (): string => join(app.getPath("userData"), "server.json");

/** The chosen server: `ST0_SYNC_ORIGIN` for a test, else the one saved at the last sign-in, else st0.app. */
export function chosenServer(): string {
  const forced = normalizeServer(process.env.ST0_SYNC_ORIGIN ?? "");
  if (forced) return forced;
  try {
    const saved = JSON.parse(readFileSync(file(), "utf8")) as {
      server?: unknown;
    };
    const s =
      typeof saved.server === "string" ? normalizeServer(saved.server) : null;
    if (s) return s;
  } catch {
    // Never chosen yet.
  }
  return STUDIO_ORIGIN;
}

/** Keep what the person typed, when it is a server address; answers the origin kept, or null. */
export function chooseServer(input: string): string | null {
  const s = normalizeServer(input);
  if (s) writeFileSync(file(), `${JSON.stringify({ server: s }, null, 2)}\n`);
  return s;
}
