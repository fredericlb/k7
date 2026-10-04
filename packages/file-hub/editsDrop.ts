// editsDrop.ts — what a PULL of a library does to the admins' own clones of it: every one goes,
// unpushed work included. A running file service is told, so it stops reading the clone; an idle
// account's clone is removed on disk, where its next start would otherwise read it again.
// See docs/fileHub.md.

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  isLibraryName,
  LIBRARY_EDITS_DIR,
} from "@studio/song-schema/moduleTypes";
import {
  ADMIN_HEADER,
  HUB_SECRET_HEADER,
  USER_HEADER,
} from "@studio/web-protocol";
import type { Instance } from "./instances.ts";

/** Drop every account's edit clone of `name`: through the running services first, then on disk for all accounts. */
export async function dropEditClones(
  dataRoot: string,
  running: Instance[],
  name: string,
  log: (msg: string) => void,
): Promise<void> {
  if (!isLibraryName(name)) return;
  for (const inst of running) {
    const r = await fetch(
      `http://127.0.0.1:${inst.port}/account/library-edits/drop`,
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
      log(`[${inst.slug}] could not drop its '${name}' clone (${r.status})`);
  }
  let accounts: string[] = [];
  try {
    accounts = readdirSync(dataRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return;
  }
  for (const a of accounts)
    rmSync(join(dataRoot, a, LIBRARY_EDITS_DIR, name), {
      recursive: true,
      force: true,
    });
}
