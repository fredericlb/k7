// benchDrop.ts — what a PULL of a library does to the benches: every account's bench clone of it
// goes. A running file service is told, so it closes the overlay that reads the clone; an idle
// account's clone is removed on disk, where the next start would otherwise read it again.
// See docs/fileHub.md.

import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isLibraryName } from "@studio/song-schema/moduleTypes";
import {
  ADMIN_HEADER,
  HUB_SECRET_HEADER,
  USER_HEADER,
} from "@studio/web-protocol";
import { BENCH_LIBRARIES_DIR } from "./binding.ts";
import type { Instance } from "./instances.ts";

/** Remove `name`'s bench clone under one account's home, and its mark as the open bench. */
function dropOnDisk(home: string, name: string): void {
  const benches = join(home, BENCH_LIBRARIES_DIR);
  rmSync(join(benches, name), { recursive: true, force: true });
  try {
    if (readFileSync(join(benches, ".active"), "utf8").trim() === name)
      rmSync(join(benches, ".active"), { force: true });
  } catch {
    /* no bench open */
  }
}

/** Drop every bench clone of `name`: through the running services first, then on disk for all accounts. */
export async function dropBenches(
  dataRoot: string,
  running: Instance[],
  name: string,
  log: (msg: string) => void,
): Promise<void> {
  if (!isLibraryName(name)) return;
  for (const inst of running) {
    const r = await fetch(
      `http://127.0.0.1:${inst.port}/account/bench-library/drop`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [USER_HEADER]: inst.user,
          [ADMIN_HEADER]: "1",
          [HUB_SECRET_HEADER]: inst.secret,
        },
        body: JSON.stringify({ name }),
      },
    ).catch((e: Error) => ({ ok: false, status: e.message }));
    if (!r.ok)
      log(`[${inst.slug}] could not drop its '${name}' bench (${r.status})`);
  }
  let accounts: string[] = [];
  try {
    accounts = readdirSync(dataRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const a of accounts) dropOnDisk(join(dataRoot, a), name);
}
