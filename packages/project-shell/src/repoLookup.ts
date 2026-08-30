// repoLookup.ts — the account's library repository, and nothing else. It asked pl8 for two
// things once: this, and the git URI behind a short name. The register is gone with the
// portable address, and the pointer moved to the machine that holds the working copies —
// apps/st0/frontend/docs/projects.md.

import type { RepoRef } from "@studio/web-protocol";
import { fget } from "./fileApi.ts";

export async function librariesRepo(): Promise<RepoRef | null> {
  // THIS MACHINE's, not pl8's: nothing outlives the machine that holds the working copies, so
  // the pointer lives beside them — apps/st0/frontend/docs/projects.md.
  const { libraries } = await fget<{ libraries: RepoRef | null }>(
    "/account/libraries",
  );
  return libraries ?? null;
}
