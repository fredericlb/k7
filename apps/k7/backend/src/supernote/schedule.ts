// The hourly run, and the only thing in this app that acts with nobody watching.
//
// One timer for every user rather than one per user: the work is a few HTTP calls and a
// handful of EPUBs, and a single timer is a single thing to reason about at 3 a.m.

import { enabledOwners } from "./config.ts";
import { syncSongbook } from "./sync.ts";

const HOUR = 60 * 60 * 1000;

async function tick(): Promise<void> {
  let owners: string[];
  try {
    owners = await enabledOwners();
  } catch (err) {
    // PocketBase unreachable or stalled: skip this hour. Escaping here would be an unhandled
    // rejection, and that takes the whole server down.
    console.warn(`   Supernote schedule skipped: ${(err as Error).message}`);
    return;
  }
  for (const ownerId of owners) {
    try {
      const report = await syncSongbook(ownerId);
      if (report.uploaded > 0) {
        console.log(`   Supernote: pushed ${report.uploaded} song(s)`);
      }
    } catch (err) {
      // A run that throws is recorded against the user and must not stop the next one.
      console.warn(`   Supernote sync failed: ${(err as Error).message}`);
    }
  }
}

/** Starts the clock. The first run is the activation's, not this one's. */
export function startSupernoteSchedule(): void {
  setInterval(() => {
    void tick();
  }, HOUR);
}
